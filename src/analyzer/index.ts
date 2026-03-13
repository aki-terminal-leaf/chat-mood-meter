/**
 * analyzer/index.ts
 * Emotion Analyzer 統一介面
 *
 * 根據 config.analyzer.mode 回傳對應的分析引擎實例：
 * - 'rules' → RulesAnalyzer（本地規則引擎，無需網路）
 * - 'llm'   → 未來擴充（LLM 推論模式，TODO）
 *
 * 對外只需 import { createAnalyzer } from './analyzer/index.js'
 */

import type { Config, ChatMessage, EmotionSnapshot } from '../types.js';
import { RulesAnalyzer } from './rules.js';
import { LLMAnalyzer } from './llm.js';
import { EventEmitter } from 'events';

// ─────────────────────────────────────────────
// 通用分析器介面
// ─────────────────────────────────────────────

/**
 * 所有分析引擎須實作的介面
 * 繼承 EventEmitter，emit 'snapshot' 事件
 */
export interface Analyzer extends EventEmitter {
  /** 啟動分析引擎 */
  start(): void;
  /** 停止分析引擎 */
  stop(): void;
  /** 餵入一則聊天訊息 */
  feed(msg: ChatMessage): void;

  // 事件型別提示（TypeScript overload）
  on(event: 'snapshot', listener: (snapshot: EmotionSnapshot) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;

  emit(event: 'snapshot', snapshot: EmotionSnapshot): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}

// ─────────────────────────────────────────────
// 工廠函式
// ─────────────────────────────────────────────

/**
 * 根據設定建立對應的分析器實例
 *
 * @param config 完整設定物件
 * @returns Analyzer 實例
 *
 * @example
 * ```ts
 * const analyzer = createAnalyzer(config);
 * analyzer.on('snapshot', (snap) => console.log(snap));
 * analyzer.start();
 * analyzer.feed(msg);
 * ```
 */
export function createAnalyzer(config: Config): Analyzer {
  const { mode, snapshotIntervalMs } = config.analyzer;

  switch (mode) {
    case 'rules':
      return new RulesAnalyzer({ snapshotIntervalMs });

    case 'llm': {
      // LLM 模式：使用 Gemini API 做情緒推論
      const llmConfig = config.analyzer.llm;
      if (!llmConfig?.apiKey) {
        // API Key 未設定時，fallback 到 rules 並警告
        console.warn('[Analyzer] LLM 模式缺少 apiKey，fallback 到 rules 模式');
        return new RulesAnalyzer({ snapshotIntervalMs });
      }
      return new LLMAnalyzer({
        apiKey:            llmConfig.apiKey,
        model:             llmConfig.model,
        batchIntervalMs:   llmConfig.batchIntervalMs,
        maxTokens:         llmConfig.maxTokens,
        snapshotIntervalMs,
      });
    }

    default: {
      // 型別系統應該擋住這裡，但以防萬一
      const _exhaustive: never = mode;
      throw new Error(`[Analyzer] 未知的分析模式：${_exhaustive}`);
    }
  }
}

// ─────────────────────────────────────────────
// 重新匯出，方便外部直接引用底層實作
// ─────────────────────────────────────────────

export { RulesAnalyzer } from './rules.js';
export { LLMAnalyzer } from './llm.js';
export { EMOTE_MAP, KEYWORD_MAP } from './emote-map.js';
export type { EmoteEntry, EmoteMap } from './emote-map.js';
