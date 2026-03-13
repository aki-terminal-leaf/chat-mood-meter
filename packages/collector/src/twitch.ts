/**
 * twitch.ts — Twitch IRC 聊天收集器
 * 使用 tmi.js 連線 Twitch IRC，解析訊息並轉換為統一的 ChatMessage 格式。
 * 透過 EventEmitter 模式對外 emit 'message' 事件。
 */

import { EventEmitter } from 'node:events';
import type { ChatMessage } from '@cmm/core';

// tmi.js 的型別宣告（套件尚未安裝，先用寬鬆型別避免編譯錯誤）
type TmiClient = {
  on(event: string, handler: (...args: unknown[]) => void): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

type TmiUserstate = {
  username?: string;
  'display-name'?: string;
  emotes?: Record<string, string[]> | null;
  id?: string;
};

interface TwitchCollectorOptions {
  channel: string;
  token?: string;    // 可選；匿名連線不需要
  identity?: {
    username: string;
    password: string;
  };
}

/**
 * TwitchCollector
 * 連接指定頻道，監聽聊天訊息，並 emit 統一格式的 ChatMessage。
 */
export class TwitchCollector extends EventEmitter {
  private client: TmiClient | null = null;
  private channel: string;
  private options: TwitchCollectorOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 5000;   // 首次重連延遲 (ms)
  private maxReconnectDelay = 60000; // 最大重連延遲 (ms)
  private stopped = false;

  constructor(options: TwitchCollectorOptions) {
    super();
    this.options = options;
    // 頻道名稱統一轉小寫，並補 # 前綴
    this.channel = options.channel.toLowerCase().startsWith('#')
      ? options.channel.toLowerCase()
      : `#${options.channel.toLowerCase()}`;
  }

  /** 啟動連線 */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  /** 停止並清理 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // 忽略斷線時的錯誤
      }
      this.client = null;
    }
  }

  /** 建立 tmi.js 用戶端並連線 */
  private async connect(): Promise<void> {
    try {
      // 動態 import tmi.js（允許套件尚未安裝時以 dynamic import 延遲失敗）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tmi = await import('tmi.js') as any;

      const clientOptions: Record<string, unknown> = {
        channels: [this.channel],
        options: { debug: false },
        connection: {
          secure: true,
          reconnect: false,  // 重連邏輯由我們自行處理
        },
      };

      // 如果有提供 token，加上身份識別（可以讀到更多 userstate 資訊）
      if (this.options.token) {
        clientOptions.identity = {
          username: this.options.identity?.username ?? 'justinfan12345',
          password: this.options.token,
        };
      }

      const TmiClient = tmi.Client ?? tmi.client ?? (tmi.default && (tmi.default.Client ?? tmi.default.client));
      this.client = new TmiClient(clientOptions) as TmiClient;
      this.bindEvents();
      await this.client.connect();
      // 連線成功後重置重連延遲
      this.reconnectDelay = 5000;
      this.emit('connected', this.channel);
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  /** 綁定 tmi.js 事件 */
  private bindEvents(): void {
    if (!this.client) return;

    // 收到聊天訊息
    this.client.on('message', (_channel: unknown, userstate: unknown, text: unknown, self: unknown) => {
      // 忽略自己送出的訊息
      if (self) return;

      const msg = this.parseMessage(userstate as TmiUserstate, String(text));
      if (msg) {
        this.emit('message', msg);
      }
    });

    // 連線中斷
    this.client.on('disconnected', (reason: unknown) => {
      this.emit('disconnected', reason);
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    // 連線錯誤
    this.client.on('error', (err: unknown) => {
      this.emit('error', err);
    });
  }

  /**
   * 將 tmi.js 的 userstate + text 轉換為統一的 ChatMessage 格式
   */
  private parseMessage(userstate: TmiUserstate, text: string): ChatMessage | null {
    const user = userstate['display-name'] ?? userstate.username ?? 'unknown';

    // 解析 emote：userstate.emotes 的格式為 { emoteId: ['startPos-endPos', ...] }
    const emotes: string[] = userstate.emotes
      ? Object.keys(userstate.emotes)
      : [];

    return {
      platform: 'twitch',
      user,
      text: text.trim(),
      emotes,
      timestamp: Date.now(),
      raw: userstate,
    };
  }

  /** 排程重連，使用指數退避策略 */
  private scheduleReconnect(): void {
    if (this.stopped) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, this.reconnectDelay);

    // 每次重連失敗後延遲加倍，但不超過最大值
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
