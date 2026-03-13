/**
 * channel-worker.ts — 單一頻道監控工作單元
 *
 * 負責：
 * - 建立 DB session
 * - 啟動 TwitchCollector（或未來的 YouTubeCollector）
 * - 接線 RulesAnalyzer、HighlightDetector
 * - 將 snapshot / highlight 存入 DB 並透過 deps 對外推送
 * - 維護 WorkerStatus 狀態機，emit 'started' / 'stopped' 事件
 */

import { EventEmitter } from 'node:events';
import { RulesAnalyzer } from '@cmm/core/analyzer';
import { HighlightDetector } from '@cmm/core/highlight';
import type { ChatMessage, EmotionSnapshot, HighlightMarker } from '@cmm/core/types';

// ─────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────

export type WorkerStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export interface WorkerConfig {
  jobId: string;
  userId: string;
  /** DB channel UUID */
  channelId: string;
  platform: 'twitch' | 'youtube';
  /** 平台頻道名稱 */
  channelName: string;
  /** YouTube 專用 */
  liveChatId?: string;
  analyzerMode?: 'rules' | 'llm';
  highlightConfig?: {
    /** 訊息密度倍率觸發閾值，預設 2.5 */
    densityMultiplier?: number;
    /** intensity 觸發閾值，預設 0.8 */
    intensityThreshold?: number;
    /** 同情緒冷卻時間（秒），預設 60 */
    cooldownSec?: number;
    /** 滑動視窗長度（秒），預設 30 */
    windowSec?: number;
  };
}

export interface WorkerDeps {
  /** WebSocket 即時推送 snapshot 給 overlay */
  onSnapshot: (channelId: string, snapshot: EmotionSnapshot) => void;
  /** WebSocket 即時推送 highlight 給 overlay */
  onHighlight: (channelId: string, marker: HighlightMarker) => void;
  /** 將 snapshot 持久化（通常透過 BatchWriter） */
  saveSnapshot: (sessionId: string, snapshot: EmotionSnapshot) => void;
  /** 將 highlight 持久化（通常透過 BatchWriter） */
  saveHighlight: (sessionId: string, marker: HighlightMarker) => void;
  /** 建立新的監聽 session，回傳 session UUID */
  createSession: (channelId: string) => Promise<string>;
  /** 結束 session 並寫入統計資料 */
  endSession: (
    sessionId: string,
    stats: { totalMessages: number; totalHighlights: number; peakIntensity: number },
  ) => Promise<void>;
}

// ─────────────────────────────────────────────
// ChannelWorker
// ─────────────────────────────────────────────

export class ChannelWorker extends EventEmitter {
  /** 聊天收集器（TwitchCollector 或未來的 YouTubeCollector） */
  private collector: any;
  private analyzer!: RulesAnalyzer;
  private detector!: HighlightDetector;

  private sessionId: string | null = null;
  private _status: WorkerStatus = 'idle';
  private startedAt: Date | null = null;

  private messageCount = 0;
  private highlightCount = 0;
  private peakIntensity = 0;

  constructor(
    private readonly config: WorkerConfig,
    private readonly deps: WorkerDeps,
  ) {
    super();
  }

  // ─── 公開屬性 ───

  get status(): WorkerStatus {
    return this._status;
  }

  // ─── 主要流程 ───

  /**
   * 啟動工作單元
   * 1. 建立 DB session
   * 2. 初始化 Analyzer & HighlightDetector
   * 3. 初始化 Collector
   * 4. 接線各元件
   * 5. 啟動 Analyzer & Collector
   */
  async start(): Promise<void> {
    if (this._status !== 'idle') {
      throw new Error(`[ChannelWorker] ${this.config.channelName} 目前狀態 ${this._status}，無法啟動`);
    }

    this._status = 'starting';

    // 1. 建立 DB session
    this.sessionId = await this.deps.createSession(this.config.channelId);
    this.startedAt = new Date();

    // 2. 初始化 Analyzer（快照間隔 1 秒）
    this.analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });

    // 3. 初始化 HighlightDetector
    //    HighlightDetector 吃 Pick<Config, 'highlight'>，需轉換格式
    const hlCfg = this.config.highlightConfig ?? {};
    this.detector = new HighlightDetector({
      highlight: {
        windowSec:          hlCfg.windowSec          ?? 30,
        densityMultiplier:  hlCfg.densityMultiplier  ?? 2.5,
        intensityThreshold: hlCfg.intensityThreshold ?? 0.8,
        cooldownSec:        hlCfg.cooldownSec        ?? 60,
      },
    });

    // 4. 初始化 Collector
    if (this.config.platform === 'twitch') {
      const { TwitchCollector } = await import('@cmm/collector/twitch');
      this.collector = new TwitchCollector({ channel: this.config.channelName });
    } else {
      // YouTube collector 在 M5 實作
      this._status = 'error';
      throw new Error('YouTube collector not yet implemented');
    }

    // 5. 接線
    this.collector.on('message', (msg: ChatMessage) => {
      this.messageCount++;
      this.analyzer.feed(msg);
    });

    this.analyzer.on('snapshot', (snap: EmotionSnapshot) => {
      if (snap.intensity > this.peakIntensity) {
        this.peakIntensity = snap.intensity;
      }
      this.deps.saveSnapshot(this.sessionId!, snap);
      this.deps.onSnapshot(this.config.channelId, snap);
      this.detector.feed(snap);
    });

    this.detector.on('highlight', (marker: HighlightMarker) => {
      this.highlightCount++;
      // 計算相對直播開始的時間偏移（秒）
      const enriched: HighlightMarker & { offsetSec: number } = {
        ...marker,
        offsetSec: Math.floor(
          (marker.timestamp - this.startedAt!.getTime()) / 1000,
        ),
      };
      this.deps.saveHighlight(this.sessionId!, enriched);
      this.deps.onHighlight(this.config.channelId, enriched);
    });

    // 6. 啟動
    this.analyzer.start();
    await this.collector.start();

    this._status = 'running';
    this.emit('started', { sessionId: this.sessionId });
  }

  /**
   * 停止工作單元
   * @param reason 停止原因（日誌用）
   */
  async stop(reason: string): Promise<void> {
    // 冪等：重複呼叫不做任何事
    if (this._status === 'stopping' || this._status === 'idle') return;

    this._status = 'stopping';

    try {
      this.analyzer?.stop();
      await this.collector?.stop?.();
      await this.deps.endSession(this.sessionId!, {
        totalMessages: this.messageCount,
        totalHighlights: this.highlightCount,
        peakIntensity: this.peakIntensity,
      });
    } catch (err) {
      console.error(`[ChannelWorker] ${this.config.channelName} 停止時發生錯誤:`, err);
    }

    this._status = 'idle';
    this.emit('stopped', { reason, sessionId: this.sessionId });
  }

  /**
   * 取得目前統計資料（不改變狀態）
   */
  getStats() {
    return {
      jobId:          this.config.jobId,
      channelName:    this.config.channelName,
      platform:       this.config.platform,
      status:         this._status,
      sessionId:      this.sessionId,
      messageCount:   this.messageCount,
      highlightCount: this.highlightCount,
      peakIntensity:  this.peakIntensity,
      uptime:         this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
    };
  }
}
