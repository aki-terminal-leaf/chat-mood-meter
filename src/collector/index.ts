/**
 * collector/index.ts — 聊天收集器統一入口
 * 根據 config 決定要啟動哪些平台的 collector，
 * 並統一對外 emit ChatMessage 事件。
 */

import { EventEmitter } from 'node:events';
import type { Config, ChatMessage } from '../types.js';
import { TwitchCollector } from './twitch.js';

/**
 * Collector
 * 管理所有平台的聊天收集器，統一以 'message' 事件輸出 ChatMessage。
 */
export class Collector extends EventEmitter {
  private config: Config;
  private collectors: EventEmitter[] = [];

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /** 根據 config 啟動所有已啟用的平台 collector */
  async start(): Promise<void> {
    const { platforms } = this.config;

    // --- Twitch ---
    if (platforms.twitch.enabled) {
      if (!platforms.twitch.channel) {
        console.warn('[Collector] Twitch 已啟用，但未設定 channel，略過。');
      } else {
        const twitch = new TwitchCollector({
          channel: platforms.twitch.channel,
          token: platforms.twitch.token || undefined,
        });

        // 轉發訊息，加上來源標記（型別已含 platform 欄位）
        twitch.on('message', (msg: ChatMessage) => {
          this.emit('message', msg);
        });

        // 轉發連線狀態事件，方便上層監聽
        twitch.on('connected', (ch: string) => {
          console.log(`[Collector] Twitch 已連線：${ch}`);
          this.emit('connected', { platform: 'twitch', channel: ch });
        });

        twitch.on('disconnected', (reason: unknown) => {
          console.warn('[Collector] Twitch 斷線：', reason);
          this.emit('disconnected', { platform: 'twitch', reason });
        });

        twitch.on('error', (err: unknown) => {
          console.error('[Collector] Twitch 錯誤：', err);
          this.emit('error', err);
        });

        await twitch.start();
        this.collectors.push(twitch);
      }
    }

    // --- YouTube（預留，M2 實作）---
    if (platforms.youtube.enabled) {
      console.warn('[Collector] YouTube collector 尚未實作，略過。');
      // TODO: import YouTubeCollector from './youtube.js';
    }

    if (this.collectors.length === 0) {
      console.warn('[Collector] 沒有任何 collector 已啟動。請確認 config 設定。');
    }
  }

  /** 停止所有 collector */
  async stop(): Promise<void> {
    for (const c of this.collectors) {
      // 各 collector 若有 stop() 方法就呼叫
      if (typeof (c as unknown as { stop?: () => Promise<void> }).stop === 'function') {
        await (c as unknown as { stop: () => Promise<void> }).stop();
      }
    }
    this.collectors = [];
  }
}
