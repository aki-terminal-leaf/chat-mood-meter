/**
 * rules.ts
 * 基於規則的情緒分析引擎 RulesAnalyzer
 *
 * 架構：
 * - 接收 ChatMessage，維護滑動視窗（預設 5 秒）
 * - 每 snapshotIntervalMs（預設 1000ms）產生 EmotionSnapshot
 * - 使用 emote-map 與關鍵詞規則計算情緒分數
 * - 繼承 EventEmitter，發送 'snapshot' 事件
 */

import { EventEmitter } from 'events';
import type { ChatMessage, EmotionScores, EmotionSnapshot, EmotionType } from '../types.js';
import { EMOTE_MAP, KEYWORD_MAP } from './emote-map.js';

// ─────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────

interface RulesAnalyzerOptions {
  /** 滑動視窗長度（毫秒），預設 5000ms */
  windowMs?: number;
  /** 快照產生間隔（毫秒），預設 1000ms */
  snapshotIntervalMs?: number;
  /** 計算 intensity 用的基線視窗（毫秒），預設 5 分鐘 */
  baselineWindowMs?: number;
}

/** 帶有計算結果的訊息快取 */
interface ScoredMessage {
  message: ChatMessage;
  scores: EmotionScores;
  totalWeight: number;
}

// ─────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────

/** 產生空的情緒分數物件 */
function zeroScores(): EmotionScores {
  return { hype: 0, funny: 0, sad: 0, angry: 0 };
}

/** 將兩個分數加權累加 */
function addWeightedScores(
  acc: EmotionScores,
  scores: EmotionScores,
  weight: number
): void {
  acc.hype  += scores.hype  * weight;
  acc.funny += scores.funny * weight;
  acc.sad   += scores.sad   * weight;
  acc.angry += scores.angry * weight;
}

/** 找出分數最高的情緒類型 */
function dominantEmotion(scores: EmotionScores): EmotionType {
  const entries = Object.entries(scores) as [EmotionType, number][];
  const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  // 若所有分數都很低，視為中性
  if (max[1] < 0.05) return 'neutral';
  return max[0];
}

/** 將分數正規化到 0-1 範圍 */
function normalizeScores(scores: EmotionScores, divisor: number): EmotionScores {
  if (divisor === 0) return zeroScores();
  return {
    hype:  Math.min(1, scores.hype  / divisor),
    funny: Math.min(1, scores.funny / divisor),
    sad:   Math.min(1, scores.sad   / divisor),
    angry: Math.min(1, scores.angry / divisor),
  };
}

// ─────────────────────────────────────────────
// RulesAnalyzer 主類別
// ─────────────────────────────────────────────

export class RulesAnalyzer extends EventEmitter {
  private readonly windowMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly baselineWindowMs: number;

  /** 當前滑動視窗內的訊息佇列 */
  private window: ScoredMessage[] = [];

  /** 用來計算基線密度的歷史訊息計數（時間戳陣列） */
  private msgTimestamps: number[] = [];

  /** 快照計時器 */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 是否已啟動 */
  private running = false;

  constructor(options: RulesAnalyzerOptions = {}) {
    super();
    this.windowMs          = options.windowMs          ?? 5_000;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 1_000;
    this.baselineWindowMs  = options.baselineWindowMs  ?? 5 * 60_000;
  }

  // ─── 公開 API ───

  /** 啟動分析引擎，開始定時產生快照 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.emitSnapshot(), this.snapshotIntervalMs);
  }

  /** 停止分析引擎 */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 接收一則聊天訊息，計算情緒分數後放入滑動視窗
   * @param msg 標準化後的 ChatMessage
   */
  feed(msg: ChatMessage): void {
    const scored = this.scoreMessage(msg);
    this.window.push(scored);
    this.msgTimestamps.push(msg.timestamp);
  }

  // ─── 核心邏輯 ───

  /**
   * 對單則訊息計算情緒分數
   * 步驟：
   * 1. 匹配 emotes 欄位中的 Twitch emote 名稱
   * 2. 掃描訊息文字，比對 EMOTE_MAP 鍵值（詞彙型 emote）
   * 3. 掃描訊息文字，比對 KEYWORD_MAP 的正則模式
   */
  private scoreMessage(msg: ChatMessage): ScoredMessage {
    const acc = zeroScores();
    let totalWeight = 0;

    // ── Step 1：處理 emotes 欄位（平台回報的 emote ID/名稱）
    for (const emoteId of msg.emotes) {
      const entry = EMOTE_MAP[emoteId];
      if (entry) {
        addWeightedScores(acc, entry.scores, entry.weight);
        totalWeight += entry.weight;
      }
    }

    // ── Step 2：掃描文字，匹配 EMOTE_MAP 中的詞彙型條目
    // 用詞彙長度由長到短排序，避免短詞蓋掉長詞
    const textLower = msg.text;  // 不 toLowerCase，保留中/日文大小寫
    for (const [key, entry] of Object.entries(EMOTE_MAP)) {
      if (textLower.includes(key)) {
        // 簡單計算出現次數（避免極端刷屏）
        const count = Math.min(countOccurrences(textLower, key), 5);
        const effectiveWeight = entry.weight * Math.sqrt(count); // 開根號，減緩多次疊加
        addWeightedScores(acc, entry.scores, effectiveWeight);
        totalWeight += effectiveWeight;
      }
    }

    // ── Step 3：正則模式關鍵詞匹配
    for (const { pattern, entry } of KEYWORD_MAP) {
      const match = msg.text.match(pattern);
      if (match) {
        addWeightedScores(acc, entry.scores, entry.weight);
        totalWeight += entry.weight;
      }
    }

    return { message: msg, scores: acc, totalWeight };
  }

  /**
   * 產生並發送 EmotionSnapshot
   * 步驟：
   * a. 清除視窗外過期的訊息
   * b. 彙總視窗內所有訊息分數（加權平均）
   * c. 計算 intensity（相對於基線的訊息密度）
   * d. 決定 dominant emotion
   */
  private emitSnapshot(): void {
    const now = Date.now();
    this.pruneWindow(now);

    const messageCount = this.window.length;

    // 空視窗 → 產生中性快照
    if (messageCount === 0) {
      const snapshot: EmotionSnapshot = {
        timestamp:    now,
        dominant:     'neutral',
        scores:       zeroScores(),
        intensity:    0,
        messageCount: 0,
      };
      this.emit('snapshot', snapshot);
      return;
    }

    // ── 彙總分數：加權平均
    const totalAcc = zeroScores();
    let totalWeight = 0;

    for (const sm of this.window) {
      if (sm.totalWeight > 0) {
        // 先把每則訊息的分數除以自身的 totalWeight，得到 0-1 的正規化分數
        const normalized = normalizeScores(sm.scores, sm.totalWeight);
        // 再以 totalWeight 作為該訊息的重要性加入彙總
        addWeightedScores(totalAcc, normalized, sm.totalWeight);
        totalWeight += sm.totalWeight;
      } else {
        // 無法識別情緒的訊息：輕微中性貢獻
        totalWeight += 0.01;
      }
    }

    // 彙總分數再正規化
    const finalScores = normalizeScores(totalAcc, totalWeight);

    // ── 計算 intensity（訊息密度正規化）
    const intensity = this.calcIntensity(now, messageCount);

    // ── 決定 dominant
    const dominant = dominantEmotion(finalScores);

    const snapshot: EmotionSnapshot = {
      timestamp:    now,
      dominant,
      scores:       finalScores,
      intensity,
      messageCount,
    };

    this.emit('snapshot', snapshot);
  }

  /**
   * 計算情緒強度（intensity），基於訊息密度
   *
   * 邏輯：
   * - 當前密度 = 視窗內訊息數 / 視窗秒數（msgs/sec）
   * - 基線密度 = 基線視窗內平均密度
   * - intensity = clamp(currentDensity / (baselineDensity * 2), 0, 1)
   *   （基線密度 2 倍為滿載，超過就 clamp 到 1）
   */
  private calcIntensity(now: number, currentCount: number): number {
    // 清除基線視窗外的時間戳
    const baselineCutoff = now - this.baselineWindowMs;
    this.msgTimestamps = this.msgTimestamps.filter(t => t >= baselineCutoff);

    const windowSec   = this.windowMs / 1000;
    const baselineSec = this.baselineWindowMs / 1000;

    const currentDensity = currentCount / windowSec;

    // 基線密度：基線視窗內所有訊息 / 基線視窗秒數
    const baselineDensity = this.msgTimestamps.length / baselineSec;

    if (baselineDensity < 0.01) {
      // 基線資料不足時，用絕對值估算
      // 超過 2 msgs/sec 視為高度活躍
      return Math.min(1, currentDensity / 2);
    }

    // 相對基線：當前密度 / (基線密度 * 2)
    return Math.min(1, currentDensity / (baselineDensity * 2));
  }

  /** 清除滑動視窗中過期的訊息 */
  private pruneWindow(now: number): void {
    const cutoff = now - this.windowMs;
    this.window = this.window.filter(sm => sm.message.timestamp >= cutoff);
  }
}

// ─────────────────────────────────────────────
// 工具函式（模組私有）
// ─────────────────────────────────────────────

/** 計算 needle 在 haystack 中出現的次數 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos   = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
