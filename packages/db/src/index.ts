/**
 * @cmm/db — 資料庫模組統一入口
 *
 * M1：SQLite（向後相容現有邏輯）
 * M2：Drizzle ORM + PostgreSQL
 */

// SQLite 實作（M1，向後相容）
export { SessionDB } from './sqlite.js';
export type { SessionSummary, SessionListItem } from './sqlite.js';

// PostgreSQL 實作（M2）
export { PostgresDB } from './postgres.js';
export type { AsyncDBRepository, SnapshotBatchItem, HighlightBatchItem } from './postgres.js';

// 批次寫入緩衝層（M2）
export { BatchWriter } from './batch-writer.js';
export type { BatchWriterDB, BatchWriterOptions } from './batch-writer.js';

// Repository 介面（供上層依賴注入使用）
export type { DBRepository } from './repository.js';

// Drizzle Schema（供 Drizzle Studio / 遷移工具使用）
export * as schema from './schema.js';
