/**
 * storage/index.ts — 儲存模組統一入口
 *
 * 匯出 SessionDB 與 ExportManager，
 * 並提供 setupStorage() 便利函式。
 */

import type { Config, EmotionSnapshot, HighlightMarker } from '../types.js';

export { SessionDB } from './db.js';
export { ExportManager } from './export.js';
export type { SessionSummary, SessionListItem } from './db.js';

import { SessionDB } from './db.js';
import { ExportManager } from './export.js';

export interface StorageContext {
  db: SessionDB;
  exporter: ExportManager;
  /** 儲存一筆 snapshot */
  saveSnapshot(snapshot: EmotionSnapshot): void;
  /** 儲存一筆 highlight */
  saveHighlight(marker: HighlightMarker): void;
  /** 結束 session */
  endSession(): void;
}

/**
 * setupStorage — 建立 DB + Exporter，回傳操作介面
 * 由 index.ts 手動呼叫 saveSnapshot/saveHighlight，不依賴 EventEmitter
 */
export function setupStorage(_server: unknown, config: Config): StorageContext {
  const db = new SessionDB(config.storage?.dbPath);
  const exporter = new ExportManager(db);

  db.startSession();
  console.log(`[Storage] 開始記錄 session：${db.getSessionId()}`);

  return {
    db,
    exporter,
    saveSnapshot(snapshot: EmotionSnapshot) {
      try {
        db.saveSnapshot(snapshot);
      } catch (err) {
        console.error('[Storage] saveSnapshot 失敗：', err);
      }
    },
    saveHighlight(marker: HighlightMarker) {
      try {
        db.saveHighlight(marker);
      } catch (err) {
        console.error('[Storage] saveHighlight 失敗：', err);
      }
    },
    endSession() {
      db.endSession();
    },
  };
}
