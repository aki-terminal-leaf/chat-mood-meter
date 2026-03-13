/**
 * storage/index.ts — 儲存模組統一入口
 *
 * 匯出 SessionDB 與 ExportManager，
 * 並提供 setupStorage() 便利函式，
 * 自動監聽 MoodServer 推送的 snapshot / highlight 寫入資料庫。
 */

import type { Config, EmotionSnapshot, HighlightMarker } from '../types.js';
import type { MoodServer } from '../server.js';

export { SessionDB } from './db.js';
export { ExportManager } from './export.js';
export type { SessionSummary, SessionListItem } from './db.js';

// 延遲 import（避免套件未安裝時在模組載入時就爆炸）
import { SessionDB } from './db.js';
import { ExportManager } from './export.js';

/**
 * StorageContext
 * setupStorage() 回傳的物件，方便外部取得 db 和 exporter。
 */
export interface StorageContext {
  db: SessionDB;
  exporter: ExportManager;
  /** 手動結束目前 session（直播結束時呼叫） */
  endSession(): void;
}

/**
 * setupStorage
 * 建立 SessionDB 與 ExportManager，並監聽 MoodServer 的事件：
 * - 'snapshot' → 自動呼叫 db.saveSnapshot()
 * - 'highlight' → 自動呼叫 db.saveHighlight()
 *
 * 會自動呼叫 db.startSession() 標記直播開始。
 *
 * @param server  MoodServer 實例
 * @param config  設定檔（從 config.storage.dbPath 取路徑）
 * @returns       StorageContext，含 db、exporter、endSession()
 */
export function setupStorage(server: MoodServer, config: Config): StorageContext {
  // 建立資料庫實例（路徑來自 config，若未設定則用預設值）
  const db = new SessionDB(config.storage?.dbPath);
  const exporter = new ExportManager(db);

  // 標記直播開始
  db.startSession();
  console.log(`[Storage] 開始記錄 session：${db.getSessionId()}`);

  // ── 監聽 snapshot 事件 ──
  // MoodServer 每次呼叫 pushSnapshot() 時，同步寫入資料庫
  (server as unknown as EventEmitterLike).on('snapshot', (data) => {
    try {
      db.saveSnapshot(data as EmotionSnapshot);
    } catch (err) {
      console.error('[Storage] saveSnapshot 失敗：', err);
    }
  });

  // ── 監聽 highlight 事件 ──
  (server as unknown as EventEmitterLike).on('highlight', (data) => {
    try {
      db.saveHighlight(data as HighlightMarker);
    } catch (err) {
      console.error('[Storage] saveHighlight 失敗：', err);
    }
  });

  return {
    db,
    exporter,
    endSession() {
      db.endSession();
    },
  };
}

// MoodServer 的事件監聽介面（寬鬆宣告，避免循環 import 問題）
interface EventEmitterLike {
  on(event: string, handler: (data: unknown) => void): void;
}
