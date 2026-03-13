/**
 * obs-marker.ts — OBS WebSocket 時間戳標記器
 *
 * 功能：
 * - 透過 obs-websocket-js（v5）連接 OBS Studio 的 WebSocket 伺服器
 * - 提供 createMarker(label) 方法，在 OBS 錄影/直播時間軸上建立章節標記
 * - 自動處理連線、斷線與重連邏輯
 * - config.obs.enabled 為 false 時，所有方法靜默返回（不連線、不報錯）
 *
 * 注意：
 * - OBSWebSocket 來自 obs-websocket-js v5（使用 named export）
 * - OBS 必須在 Tools → WebSocket Server Settings 啟用 WebSocket
 * - 「建立章節標記」對應 OBS WebSocket Request: CreateSceneCollectionItem？
 *   實際上 OBS ws 沒有直接的 "marker" API；
 *   這裡使用 CreateRecordChapter（OBS 30+ 支援）或 fallback 到 BroadcastCustomEvent
 */

import type { Config } from '../types.js';

// obs-websocket-js v5 的型別（套件尚未安裝，先用鬆散宣告避免編譯錯誤）
// 當套件安裝後，可改成：import OBSWebSocket from 'obs-websocket-js';
type OBSWebSocketInstance = {
  connect(url: string, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  call(requestType: string, requestData?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

// ─────────────────────────────────────────────
// 重連策略常數
// ─────────────────────────────────────────────

/** 初始重連延遲（ms） */
const RECONNECT_INITIAL_MS = 3_000;
/** 最大重連延遲（ms） */
const RECONNECT_MAX_MS = 60_000;
/** 重連延遲倍增係數 */
const RECONNECT_BACKOFF = 2;

// ─────────────────────────────────────────────
// OBSMarker
// ─────────────────────────────────────────────

export class OBSMarker {
  private readonly cfg: Config['obs'];

  /** obs-websocket-js 實例（動態 import 後建立） */
  private obs: OBSWebSocketInstance | null = null;

  /** 目前是否已成功連線 */
  private connected = false;

  /** 是否正在進行重連（防止重複觸發） */
  private reconnecting = false;

  /** 目前的重連延遲（ms），指數退避用 */
  private reconnectDelayMs = RECONNECT_INITIAL_MS;

  /** 重連計時器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 是否已主動呼叫 disconnect()（避免主動斷線後自動重連） */
  private intentionalDisconnect = false;

  constructor(config: Pick<Config, 'obs'>) {
    this.cfg = config.obs;
  }

  // ─────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────

  /**
   * 初始化並連線到 OBS WebSocket
   * 若 config.obs.enabled 為 false，直接返回
   */
  async connect(): Promise<void> {
    if (!this.cfg.enabled) {
      console.log('[OBSMarker] OBS 整合已停用，跳過連線');
      return;
    }

    try {
      // 動態 import obs-websocket-js（避免套件未安裝時整個模組 crash）
      // @ts-ignore — 套件未安裝時型別不存在，執行期以 catch 處理
      const obsModule = await import('obs-websocket-js').catch(() => null);
      if (!obsModule) {
        console.warn('[OBSMarker] obs-websocket-js 套件未安裝，OBS 功能停用');
        return;
      }

      // obs-websocket-js v5 使用 default export
      const OBSWebSocket = (obsModule.default ?? obsModule) as unknown as new () => OBSWebSocketInstance;
      this.obs = new OBSWebSocket();

      // 監聽斷線事件，觸發自動重連
      this.obs.on('ConnectionClosed', () => {
        this.connected = false;
        if (!this.intentionalDisconnect) {
          console.warn('[OBSMarker] OBS 連線中斷，準備重連...');
          this.scheduleReconnect();
        }
      });

      await this.doConnect();
    } catch (err) {
      console.error('[OBSMarker] 連線初始化失敗：', err);
      this.scheduleReconnect();
    }
  }

  /**
   * 主動斷線（通常在程式關閉時呼叫）
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.obs && this.connected) {
      try {
        await this.obs.disconnect();
        console.log('[OBSMarker] 已主動斷線');
      } catch (err) {
        console.error('[OBSMarker] 斷線時發生錯誤：', err);
      }
    }

    this.connected = false;
  }

  /**
   * 在 OBS 建立時間戳章節標記
   * - 若 obs.enabled 為 false，靜默返回
   * - 若目前未連線，記錄警告後返回（不拋出例外）
   * - 優先使用 CreateRecordChapter（OBS 30+），失敗時 fallback 到 BroadcastCustomEvent
   *
   * @param label 標記名稱，例如 "HYPE x2.5" 或 "FUNNY 🤣"
   */
  async createMarker(label: string): Promise<void> {
    // OBS 整合停用時靜默返回
    if (!this.cfg.enabled) return;

    // 未連線時記錄警告，不阻斷主流程
    if (!this.connected || !this.obs) {
      console.warn(`[OBSMarker] 尚未連線，無法建立標記：${label}`);
      return;
    }

    try {
      // 優先嘗試 CreateRecordChapter（OBS Studio 30.x+ 支援）
      await this.obs.call('CreateRecordChapter', { chapterName: label });
      console.log(`[OBSMarker] ✅ 章節標記已建立：${label}`);
    } catch (primaryErr) {
      // 若 OBS 版本不支援 CreateRecordChapter，改用 BroadcastCustomEvent 作為 fallback
      console.warn('[OBSMarker] CreateRecordChapter 失敗，改用 BroadcastCustomEvent：', primaryErr);
      try {
        await this.obs.call('BroadcastCustomEvent', {
          eventData: {
            type: 'highlight-marker',
            label,
            timestamp: new Date().toISOString(),
          },
        });
        console.log(`[OBSMarker] 📡 自訂事件已廣播：${label}`);
      } catch (fallbackErr) {
        console.error('[OBSMarker] fallback 也失敗了：', fallbackErr);
      }
    }
  }

  // ─────────────────────────────────────────────
  // 內部連線邏輯
  // ─────────────────────────────────────────────

  /**
   * 實際執行連線
   */
  private async doConnect(): Promise<void> {
    if (!this.obs) return;

    const url = `ws://${this.cfg.host}:${this.cfg.port}`;
    console.log(`[OBSMarker] 正在連線到 OBS WebSocket：${url}`);

    try {
      await this.obs.connect(url, this.cfg.password || undefined);
      this.connected = true;
      this.reconnectDelayMs = RECONNECT_INITIAL_MS; // 連線成功，重置退避計時
      this.reconnecting = false;
      console.log('[OBSMarker] ✅ 已成功連線到 OBS WebSocket');
    } catch (err) {
      console.error('[OBSMarker] 連線失敗：', err);
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  /**
   * 安排指數退避重連
   */
  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnecting) return;

    this.reconnecting = true;
    console.log(`[OBSMarker] ${this.reconnectDelayMs / 1000}s 後重試連線...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnecting = false;
      await this.doConnect();
    }, this.reconnectDelayMs);

    // 指數退避，上限為 RECONNECT_MAX_MS
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * RECONNECT_BACKOFF,
      RECONNECT_MAX_MS
    );
  }

  /**
   * 清除重連計時器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
  }
}
