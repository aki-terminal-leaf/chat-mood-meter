/**
 * repository.ts — 統一的 DB 存取介面（Repository Pattern）
 *
 * 上層模組只依賴這個介面，不需要知道底層是 SQLite 還是 PostgreSQL。
 * M2 遷移到 PostgreSQL 時，只需要新增 PostgresDB 實作，上層程式碼不變。
 */

import type { EmotionSnapshot, HighlightMarker } from '@cmm/core/types';
import type { SessionSummary, SessionListItem } from './sqlite.js';

// 重新匯出型別，讓外部可直接從 repository 取用
export type { SessionSummary, SessionListItem };

/**
 * DBRepository — 資料庫存取介面
 *
 * 定義 SessionDB 必須實作的所有方法。
 * 未來 PostgresDB 也需要實作相同介面，確保可互換。
 */
export interface DBRepository {
  // ── Session 管理 ────────────────────────────────────────────

  /** 開始新 session，在 sessions 表建立紀錄，回傳 sessionId */
  startSession(): void;

  /** 結束目前 session，更新 ended_at 與 total_messages */
  endSession(): void;

  /** 取得目前 sessionId（ISO 格式字串） */
  getSessionId(): string;

  // ── 寫入 ────────────────────────────────────────────────────

  /** 儲存一筆情緒快照 */
  saveSnapshot(snapshot: EmotionSnapshot): void;

  /** 儲存一筆高光標記 */
  saveHighlight(marker: HighlightMarker): void;

  // ── 讀取 ────────────────────────────────────────────────────

  /** 列出所有 session（按開始時間降序） */
  listSessions(): SessionListItem[];

  /** 取得指定 session 的完整摘要，找不到時回傳 null */
  getSessionSummary(sessionId: string): SessionSummary | null;

  /** 取得指定 session 的所有快照（按時間升序） */
  getSnapshots(sessionId: string): EmotionSnapshot[];

  /** 取得指定 session 的所有高光標記（按時間升序） */
  getHighlights(sessionId: string): HighlightMarker[];

  // ── 生命週期 ────────────────────────────────────────────────

  /** 關閉資料庫連線，釋放資源 */
  close(): void;
}
