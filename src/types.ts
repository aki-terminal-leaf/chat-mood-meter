// === 共用型別定義 ===

/** 統一聊天訊息格式 */
export interface ChatMessage {
  platform: 'twitch' | 'youtube';
  user: string;
  text: string;
  emotes: string[];      // emote IDs or names
  timestamp: number;     // unix ms
  raw?: unknown;
}

/** 情緒分類 */
export type EmotionType = 'hype' | 'funny' | 'sad' | 'angry' | 'neutral';

/** 情緒分數 */
export interface EmotionScores {
  hype: number;    // 0-1
  funny: number;
  sad: number;
  angry: number;
}

/** 每秒情緒快照 */
export interface EmotionSnapshot {
  timestamp: number;
  dominant: EmotionType;
  scores: EmotionScores;
  intensity: number;       // 0-1, overall excitement level
  messageCount: number;    // messages in this window
}

/** 高光標記 */
export interface HighlightMarker {
  timestamp: number;
  emotion: EmotionType;
  intensity: number;
  duration: number;        // ms
  sampleMessages: string[];
}

/** WebSocket 推送事件 */
export type WSEvent =
  | { type: 'snapshot'; data: EmotionSnapshot }
  | { type: 'highlight'; data: HighlightMarker }
  | { type: 'chat'; data: ChatMessage };

/** 設定檔 */
export interface Config {
  platforms: {
    twitch: {
      enabled: boolean;
      channel: string;
      token: string;
    };
    youtube: {
      enabled: boolean;
      liveChatId: string;
      apiKey: string;
    };
  };
  analyzer: {
    mode: 'rules' | 'llm';
    snapshotIntervalMs: number;
    /** LLM 模式專屬設定（mode === 'llm' 時必填） */
    llm?: {
      /** Gemini API Key */
      apiKey: string;
      /** 模型名稱，預設 gemini-2.0-flash */
      model?: string;
      /** 批次送出間隔（毫秒），預設 5000ms */
      batchIntervalMs?: number;
      /** 回應最大 token 數，預設 256 */
      maxTokens?: number;
    };
  };
  highlight: {
    windowSec: number;
    densityMultiplier: number;
    intensityThreshold: number;
    cooldownSec: number;
  };
  overlay: {
    port: number;
    historyMinutes: number;
  };
  obs: {
    enabled: boolean;
    host: string;
    port: number;
    password: string;
  };
  storage: {
    dbPath: string;
  };
}
