/**
 * llm.ts
 * 基於 LLM 的情緒分析引擎 LLMAnalyzer
 *
 * 架構：
 * - 接收 ChatMessage，累積到緩衝區
 * - 每 batchIntervalMs（預設 5000ms）將緩衝區批次送給 Gemini API
 * - 批次間隔內，用上一次的分析結果持續 emit snapshot（維持節奏）
 * - API 失敗時 fallback 到上一次的分數，避免斷訊
 * - 繼承 EventEmitter，發送 'snapshot' 事件
 */

import { EventEmitter } from 'events';
import type { ChatMessage, EmotionScores, EmotionSnapshot, EmotionType } from '../types.js';

// ─────────────────────────────────────────────
// 型別定義
// ─────────────────────────────────────────────

/**
 * LLMAnalyzer 建構子選項
 * 所有參數皆從 config 注入，不寫死
 */
interface LLMAnalyzerOptions {
  /** Gemini API Key */
  apiKey: string;
  /** 模型名稱，預設 gemini-2.0-flash */
  model?: string;
  /** 批次送出間隔（毫秒），預設 5000ms */
  batchIntervalMs?: number;
  /** 回應最大 token 數，預設 256 */
  maxTokens?: number;
  /** Snapshot emit 間隔（毫秒），預設 1000ms */
  snapshotIntervalMs?: number;
}

/**
 * Gemini API 回傳的情緒分析結果
 * （包含 summary 欄位，是 LLM 模式額外提供的功能）
 */
interface LLMResult {
  scores: EmotionScores;
  dominant: EmotionType;
  /** 一句話描述當前聊天室氣氛 */
  summary: string;
}

// ─────────────────────────────────────────────
// 常數
// ─────────────────────────────────────────────

/** 預設情緒分數（全中性，初始狀態用） */
const DEFAULT_SCORES: EmotionScores = {
  hype: 0,
  funny: 0,
  sad: 0,
  angry: 0,
};

/** Gemini API 端點（v1beta，支援 gemini-2.0-flash） */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ─────────────────────────────────────────────
// Few-shot Prompt 範例
// ─────────────────────────────────────────────

/**
 * System prompt 與 few-shot 範例
 * 支援中英雙語分析
 */
const SYSTEM_PROMPT = `你是直播聊天情緒分析器。分析以下聊天訊息，回傳 JSON 格式的情緒分數。
You are a live stream chat emotion analyzer. Analyze the chat messages below and return emotion scores in JSON format.

情緒分數範圍 / Score range: 0.0 ~ 1.0
- hype: 興奮、炒熱氣氛、應援 / excitement, hype, cheering
- funny: 好笑、幽默、整蠱 / funny, humor, trolling
- sad: 悲傷、失落、可憐 / sad, disappointed, sympathy
- angry: 憤怒、不滿、嗆聲 / angry, frustrated, hostile

回傳格式 / Return format (JSON only, no markdown):
{"hype":0.0,"funny":0.0,"sad":0.0,"angry":0.0,"dominant":"neutral","summary":"描述氣氛的一句話"}

dominant 可能值 / dominant values: "hype" | "funny" | "sad" | "angry" | "neutral"
若所有分數皆低於 0.1，dominant 填 "neutral"。

--- 範例 / Examples ---

輸入 / Input:
[StreamerFan]: POG POG POG he clutched it!!
[twitchuser99]: LETSGOOO
[观众甲]: 這也太帥了吧！！！
[viewer2]: no way that just happened

輸出 / Output:
{"hype":0.95,"funny":0.1,"sad":0.0,"angry":0.0,"dominant":"hype","summary":"聊天室因為精彩操作而大爆炸，現場氣氛瞬間沸騰"}

---

輸入 / Input:
[chatter_x]: lmaooo he just tripped on nothing
[笑死哈哈]: 哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈
[viewer88]: KEKW KEKW KEKW
[random123]: omg that was so unexpected xD

輸出 / Output:
{"hype":0.2,"funny":0.92,"sad":0.0,"angry":0.0,"dominant":"funny","summary":"主播的烏龍行為引發全場大笑，氣氛輕鬆搞笑"}

---

輸入 / Input:
[longtimefan]: this is so unfair... been subbed for 2 years
[lurker_a]: he deserved better :(
[觀眾乙]: 好可惜喔，努力了這麼久
[viewer77]: it's over...

輸出 / Output:
{"hype":0.0,"funny":0.0,"sad":0.88,"angry":0.15,"dominant":"sad","summary":"聊天室瀰漫著惋惜和失落的情緒，大家都替主播感到不捨"}

--- 請分析以下訊息 / Analyze the following messages ---`;

// ─────────────────────────────────────────────
// LLMAnalyzer 主類別
// ─────────────────────────────────────────────

export class LLMAnalyzer extends EventEmitter {
  // ── 設定
  private readonly apiKey: string;
  private readonly model: string;
  private readonly batchIntervalMs: number;
  private readonly maxTokens: number;
  private readonly snapshotIntervalMs: number;

  // ── 狀態
  /** 待送出的訊息緩衝區 */
  private buffer: ChatMessage[] = [];

  /** 上一次 LLM 分析的結果（用於 fallback 和內插） */
  private lastResult: LLMResult = {
    scores: { ...DEFAULT_SCORES },
    dominant: 'neutral',
    summary: '',
  };

  /** 目前視窗內的訊息計數（用於 snapshot.messageCount） */
  private windowMessageCount = 0;

  /** 批次處理計時器 */
  private batchTimer: ReturnType<typeof setInterval> | null = null;

  /** Snapshot emit 計時器 */
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否已啟動 */
  private running = false;

  /** 指數退避：下次允許 API 呼叫的時間戳 */
  private backoffUntil = 0;

  /** 連續失敗次數（用來計算退避時間） */
  private consecutiveFailures = 0;

  constructor(options: LLMAnalyzerOptions) {
    super();
    this.apiKey             = options.apiKey;
    this.model              = options.model            ?? 'gemini-2.0-flash';
    this.batchIntervalMs    = options.batchIntervalMs  ?? 5_000;
    this.maxTokens          = options.maxTokens        ?? 256;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 1_000;
  }

  // ─────────────────────────────────────────────
  // 公開 API（對齊 Analyzer 介面）
  // ─────────────────────────────────────────────

  /** 啟動分析引擎 */
  start(): void {
    if (this.running) return;
    this.running = true;

    // 每秒 emit snapshot（使用上次 LLM 結果）
    this.snapshotTimer = setInterval(
      () => this.emitSnapshot(),
      this.snapshotIntervalMs
    );

    // 每 batchIntervalMs 觸發一次 LLM 批次分析
    this.batchTimer = setInterval(
      () => this.processBatch(),
      this.batchIntervalMs
    );

    console.log(
      `[LLMAnalyzer] 啟動完成 | model=${this.model} | batch=${this.batchIntervalMs}ms`
    );
  }

  /** 停止分析引擎 */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    console.log('[LLMAnalyzer] 已停止');
  }

  /**
   * 接收一則聊天訊息，加入緩衝區等待下次批次處理
   * @param msg 標準化後的 ChatMessage
   */
  feed(msg: ChatMessage): void {
    this.buffer.push(msg);
    this.windowMessageCount++;
  }

  // ─────────────────────────────────────────────
  // Snapshot 發送
  // ─────────────────────────────────────────────

  /**
   * 每秒產生並 emit EmotionSnapshot
   * 使用最近一次 LLM 分析的結果（不等待下一次批次）
   */
  private emitSnapshot(): void {
    const snapshot: EmotionSnapshot = {
      timestamp:    Date.now(),
      dominant:     this.lastResult.dominant,
      scores:       { ...this.lastResult.scores },
      // intensity：以 windowMessageCount 概略估算（每秒超過 5 則視為高活躍）
      intensity:    Math.min(1, this.windowMessageCount / 5),
      messageCount: this.windowMessageCount,
    };

    // 每秒重置計數，這樣下一秒的 intensity 反映當前活躍度
    this.windowMessageCount = 0;

    this.emit('snapshot', snapshot);
  }

  // ─────────────────────────────────────────────
  // 批次處理核心
  // ─────────────────────────────────────────────

  /**
   * 將緩衝區的訊息批次送給 Gemini API 分析
   * - 若緩衝區為空，跳過此次批次
   * - 若目前在退避期間，跳過並等待
   */
  private async processBatch(): Promise<void> {
    // 沒有新訊息就不送
    if (this.buffer.length === 0) return;

    // 退避期間跳過
    if (Date.now() < this.backoffUntil) {
      const waitSec = ((this.backoffUntil - Date.now()) / 1000).toFixed(1);
      console.warn(`[LLMAnalyzer] 退避中，跳過批次（剩餘 ${waitSec}s）`);
      return;
    }

    // 取走緩衝區（不清空等待中的訊息，改用 splice 確保原子性）
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      const result = await this.callGeminiAPI(batch);
      // API 成功：更新結果、重置失敗計數
      this.lastResult = result;
      this.consecutiveFailures = 0;
      console.log(
        `[LLMAnalyzer] 批次完成 | msgs=${batch.length} | dominant=${result.dominant} | summary="${result.summary}"`
      );
    } catch (err) {
      // API 失敗：fallback 到上一次結果，計算退避時間
      this.consecutiveFailures++;
      const backoffMs = this.calcBackoff(this.consecutiveFailures);
      this.backoffUntil = Date.now() + backoffMs;
      console.error(
        `[LLMAnalyzer] API 失敗（第 ${this.consecutiveFailures} 次），退避 ${backoffMs}ms`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ─────────────────────────────────────────────
  // Gemini API 呼叫
  // ─────────────────────────────────────────────

  /**
   * 將批次訊息轉成文字並呼叫 Gemini API
   * @param messages 這次批次的訊息列表
   * @returns 解析後的 LLMResult
   */
  private async callGeminiAPI(messages: ChatMessage[]): Promise<LLMResult> {
    // 格式化訊息為 [user]: text 格式
    const chatLines = messages
      .map(m => `[${m.user}]: ${m.text}`)
      .join('\n');

    const prompt = `${SYSTEM_PROMPT}\n\n${chatLines}`;

    // 使用 REST API（避免直接 import @google/generative-ai，讓套件安裝獨立）
    const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: 0.2,        // 低溫度，讓結果更穩定
        candidateCount: 1,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000), // 15 秒 timeout
    });

    // Rate limit 處理（429）
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 30_000;
      throw new RateLimitError(`Rate limited，建議等待 ${waitMs}ms`, waitMs);
    }

    if (!response.ok) {
      throw new Error(`Gemini API 回傳 ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as GeminiResponse;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return this.parseResult(rawText);
  }

  // ─────────────────────────────────────────────
  // 結果解析
  // ─────────────────────────────────────────────

  /**
   * 解析 LLM 回傳的文字，提取情緒分數
   *
   * 策略（依序嘗試）：
   * 1. 直接 JSON.parse
   * 2. 用正則從文字中擷取 JSON 物件
   * 3. 用正則逐一提取數字（最後防線）
   * 4. 全部失敗 → fallback 到上一次結果
   */
  private parseResult(rawText: string): LLMResult {
    const text = rawText.trim();

    // ── 策略 1：直接 JSON.parse
    try {
      const parsed = JSON.parse(text);
      return this.validateAndNormalize(parsed);
    } catch {
      // 繼續嘗試其他策略
    }

    // ── 策略 2：用正則從回應中擷取 JSON 物件
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validateAndNormalize(parsed);
      } catch {
        // 繼續
      }
    }

    // ── 策略 3：用正則逐一提取數字
    console.warn('[LLMAnalyzer] JSON 解析失敗，嘗試正則提取數字');
    const extractFloat = (key: string): number => {
      const match = text.match(new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`));
      return match ? Math.min(1, Math.max(0, parseFloat(match[1]))) : 0;
    };
    const extractStr = (key: string): string => {
      const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
      return match ? match[1] : '';
    };

    const scores: EmotionScores = {
      hype:  extractFloat('hype'),
      funny: extractFloat('funny'),
      sad:   extractFloat('sad'),
      angry: extractFloat('angry'),
    };
    const dominant = this.calcDominant(scores);
    const summary  = extractStr('summary') || '（解析失敗，使用推算結果）';

    return { scores, dominant, summary };
  }

  /**
   * 驗證並正規化 LLM 回傳的 JSON 物件
   * 確保所有欄位都在合理範圍內
   */
  private validateAndNormalize(obj: Record<string, unknown>): LLMResult {
    const clamp = (v: unknown): number =>
      typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0;

    const scores: EmotionScores = {
      hype:  clamp(obj['hype']),
      funny: clamp(obj['funny']),
      sad:   clamp(obj['sad']),
      angry: clamp(obj['angry']),
    };

    // dominant 欄位：LLM 給的優先，否則自動計算
    const validDominants: EmotionType[] = ['hype', 'funny', 'sad', 'angry', 'neutral'];
    const dominant: EmotionType =
      typeof obj['dominant'] === 'string' && validDominants.includes(obj['dominant'] as EmotionType)
        ? (obj['dominant'] as EmotionType)
        : this.calcDominant(scores);

    const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';

    return { scores, dominant, summary };
  }

  /**
   * 從分數計算 dominant emotion
   * 若所有分數皆低於 0.1，回傳 neutral
   */
  private calcDominant(scores: EmotionScores): EmotionType {
    const entries = Object.entries(scores) as [EmotionType, number][];
    const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    return max[1] < 0.1 ? 'neutral' : max[0];
  }

  // ─────────────────────────────────────────────
  // 退避計算
  // ─────────────────────────────────────────────

  /**
   * 指數退避計算
   * 第 n 次失敗 → 等待 2^n 秒，最長 5 分鐘
   * @param failureCount 連續失敗次數
   */
  private calcBackoff(failureCount: number): number {
    const baseMs  = 1_000;
    const maxMs   = 5 * 60_000; // 5 分鐘上限
    return Math.min(maxMs, baseMs * Math.pow(2, failureCount));
  }
}

// ─────────────────────────────────────────────
// 輔助型別（Gemini REST API 回應格式）
// ─────────────────────────────────────────────

/** Gemini REST API 回應的結構（只定義用到的部分） */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

/** Rate limit 錯誤，帶有建議等待時間 */
class RateLimitError extends Error {
  readonly waitMs: number;
  constructor(message: string, waitMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.waitMs = waitMs;
  }
}
