/**
 * @cmm/db — 資料庫模組統一入口
 *
 * M1：SQLite（向後相容現有邏輯）
 * M2（計畫中）：遷移至 Drizzle ORM + PostgreSQL
 */

// 統一匯出
export { SessionDB } from './sqlite.js';
export type { SessionSummary, SessionListItem } from './sqlite.js';

// Repository 介面（供上層依賴注入使用）
export type { DBRepository } from './repository.js';

// 未來 M2 會加入：
// export { PostgresDB } from './postgres.js';
// export { migrate } from './migrations.js';
