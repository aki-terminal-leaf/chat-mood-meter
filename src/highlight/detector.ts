/**
 * detector.ts — 高光偵測器
 *
 * 架構：
 * - 接收來自 RulesAnalyzer（或其他 analyzer）的 EmotionSnapshot 串流
 * - 維護滑動視窗，持續監測訊息密度、intensity 和情緒跳升
 * - 滿足任一觸發條件時，emit 'highlight' 事件並附帶 HighlightMarker
 * - 同類情緒在冷卻時間內不重複觸發
 */

import { EventEmitter } from 'events';
import type { EmotionSnapshot, EmotionType, HighlightMarker, Config } from '../types.js';

// ─────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────

/** highlight config 的預設值 */
const DEFAULTS = {
  windowSec: 30,
  densityMultiplier: 2.5,
  intensityThreshold: 0.8,
  cooldownSec: 60,
} as const;

/** 情緒 delta 觸發閾值（情緒分數相對前一視窗跳升幅度） */
const EMOTION_DELTA_THRESHOLD = 0.3;

/** 觸發前後各保留幾則代表性訊息文字（透過 snapshot 的 messageCount 估算） */
const SAMPLE_WINDOW_SIZE = 5;

// ─────────────────────────────────────────────
// HighlightDetector
// ─────────────────────────────────────────────

export class HighlightDetector extends EventEmitter {
  /** 設定值（直接取 config.highlight 區段） */
  private readonly cfg: Config['highlight'];

  /** 滑動視窗內的 snapshot 快取（按時間排列） */
  private window: EmotionSnapshot[] = [];

  /**
   * 訊息密度歷史（用於計算基線平均）
   * 記錄每個 snapshot 的 messageCount
   */
  private densityHistory: number[] = [];

  /**
   * 前一個視窗結束時的情緒分數（用於計算 delta）
   * key = EmotionType，value = 0-1 分數
   */
  private prevWindowScores: Partial<Record<EmotionType, number>> = {};

  /**
   * 冷卻機制：記錄各情緒類型最後觸發的時間戳（unix ms）
   * key = EmotionType
   */
  private lastTriggerTime: Partial<Record<EmotionType, number>> = {};

  /**
   * 暫存最近的 snapshot 文字樣本
   * 用於觸發時收集 sampleMessages
   * 這裡存 snapshot 的 dominant + intensity 描述字串
   */
  private recentSnapshots: EmotionSnapshot[] = [];

  /** 上次視窗計算的時間點（ms），用來判斷何時應該「滾動」視窗 */
  private lastWindowRollTime = 0;

  constructor(config: Pick<Config, 'highlight'>) {
    super();
    // 合併預設值，確保 config 沒填的欄位有 fallback
    this.cfg = {
      windowSec:          config.highlight.windowSec          ?? DEFAULTS.windowSec,
      densityMultiplier:  config.highlight.densityMultiplier  ?? DEFAULTS.densityMultiplier,
      intensityThreshold: config.highlight.intensityThreshold ?? DEFAULTS.intensityThreshold,
      cooldownSec:        config.highlight.cooldownSec        ?? DEFAULTS.cooldownSec,
    };
  }

  // ─────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────

  /**
   * 餵入一個 EmotionSnapshot
   * 由外部（通常是 setupHighlight）監聽 analyzer 的 'snapshot' 事件後呼叫
   */
  feed(snapshot: EmotionSnapshot): void {
    const now = snapshot.timestamp;

    // 加入滑動視窗與近期快照暫存
    this.window.push(snapshot);
    this.recentSnapshots.push(snapshot);

    // 修剪視窗（移除超過 windowSec 的舊資料）
    const cutoff = now - this.cfg.windowSec * 1000;
    this.window = this.window.filter(s => s.timestamp >= cutoff);

    // 近期快照最多保留 SAMPLE_WINDOW_SIZE * 2 筆（供觸發前後取樣）
    if (this.recentSnapshots.length > SAMPLE_WINDOW_SIZE * 4) {
      this.recentSnapshots = this.recentSnapshots.slice(-SAMPLE_WINDOW_SIZE * 4);
    }

    // 每次餵入後都嘗試偵測高光
    this.detect(snapshot, now);

    // 定期（每 windowSec 秒）更新 prevWindowScores，供 delta 計算使用
    if (now - this.lastWindowRollTime >= this.cfg.windowSec * 1000) {
      this.rollWindow(now);
    }
  }

  // ─────────────────────────────────────────────
  // 偵測核心
  // ─────────────────────────────────────────────

  /**
   * 偵測高光觸發條件
   * 三條件任一滿足 + 冷卻通過 → 觸發
   */
  private detect(latest: EmotionSnapshot, now: number): void {
    const emotion = latest.dominant;

    // ── 冷卻檢查：同情緒類型在 cooldownSec 內不重複觸發
    if (!this.isCooledDown(emotion, now)) return;

    // 計算視窗內的訊息密度基線（平均 messageCount）
    const baselineDensity = this.calcBaselineDensity();

    // 條件 a：訊息密度突增
    const currentDensity = latest.messageCount;
    const densityTriggered =
      baselineDensity > 0 &&
      currentDensity > baselineDensity * this.cfg.densityMultiplier;

    // 條件 b：intensity 超過閾值
    const intensityTriggered = latest.intensity >= this.cfg.intensityThreshold;

    // 條件 c：dominant 情緒分數相對前一視窗跳升
    const deltaTriggered = this.checkEmotionDelta(latest);

    if (!densityTriggered && !intensityTriggered && !deltaTriggered) return;

    // ── 觸發高光！記錄冷卻時間，建立 HighlightMarker，emit 事件
    this.lastTriggerTime[emotion] = now;

    // 記錄密度歷史（供後續基線計算使用）
    this.densityHistory.push(currentDensity);
    // 只保留最近 200 筆，防止記憶體無限增長
    if (this.densityHistory.length > 200) {
      this.densityHistory = this.densityHistory.slice(-200);
    }

    const marker = this.buildMarker(latest, now);
    this.emit('highlight', marker);
  }

  /**
   * 計算視窗內的基線訊息密度（平均 messageCount）
   * 使用 densityHistory 中最近的資料估算
   */
  private calcBaselineDensity(): number {
    // 若密度歷史不足，改用視窗內的 snapshot 平均
    const source =
      this.densityHistory.length >= 5
        ? this.densityHistory.slice(-50)  // 取最近 50 筆
        : this.window.map(s => s.messageCount);

    if (source.length === 0) return 0;
    return source.reduce((a, b) => a + b, 0) / source.length;
  }

  /**
   * 檢查情緒分數是否相對前一視窗出現明顯跳升（delta > EMOTION_DELTA_THRESHOLD）
   * 只檢查目前 dominant 情緒對應的分數
   */
  private checkEmotionDelta(snapshot: EmotionSnapshot): boolean {
    const emotion = snapshot.dominant;
    if (emotion === 'neutral') return false;

    const currentScore = snapshot.scores[emotion as keyof typeof snapshot.scores] ?? 0;
    const prevScore = this.prevWindowScores[emotion] ?? 0;

    return currentScore - prevScore > EMOTION_DELTA_THRESHOLD;
  }

  /**
   * 滾動視窗：更新 prevWindowScores 為目前視窗的平均情緒分數
   */
  private rollWindow(now: number): void {
    this.lastWindowRollTime = now;
    if (this.window.length === 0) return;

    // 計算視窗內各情緒分數的平均值
    const emotions: Array<keyof typeof this.window[0]['scores']> = ['hype', 'funny', 'sad', 'angry'];
    const newScores: Partial<Record<EmotionType, number>> = {};

    for (const e of emotions) {
      const avg =
        this.window.reduce((sum, s) => sum + (s.scores[e] ?? 0), 0) / this.window.length;
      newScores[e as EmotionType] = avg;
    }

    this.prevWindowScores = newScores;
  }

  /**
   * 冷卻檢查：回傳該情緒類型是否已超過 cooldownSec
   */
  private isCooledDown(emotion: EmotionType, now: number): boolean {
    const last = this.lastTriggerTime[emotion];
    if (last === undefined) return true;
    return now - last >= this.cfg.cooldownSec * 1000;
  }

  /**
   * 建立 HighlightMarker
   * sampleMessages：從 recentSnapshots 取觸發時間點附近的訊息描述
   */
  private buildMarker(snapshot: EmotionSnapshot, now: number): HighlightMarker {
    // 從 recentSnapshots 中擷取最近 SAMPLE_WINDOW_SIZE 筆，作為代表性樣本
    // 實際上 snapshot 本身沒有原始訊息文字（只有統計資料），
    // 所以這裡產生人類可讀的描述字串，供 overlay 顯示參考
    const samples = this.recentSnapshots
      .slice(-SAMPLE_WINDOW_SIZE)
      .map(s =>
        `[${new Date(s.timestamp).toISOString()}] ` +
        `dominant=${s.dominant} ` +
        `intensity=${s.intensity.toFixed(2)} ` +
        `msgs=${s.messageCount}`
      );

    return {
      timestamp: now,
      emotion:   snapshot.dominant,
      intensity: snapshot.intensity,
      duration:  this.cfg.windowSec * 1000,
      sampleMessages: samples,
    };
  }
}
