/**
 * db.ts — SQLite 資料庫層
 *
 * 使用 better-sqlite3 同步 API，效能最佳且無 callback 地獄。
 * 每場直播建立一個 session，用 ISO 日期時間格式的 sessionId 標識。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { EmotionSnapshot, HighlightMarker } from '../types.js';

// 在 ESM 環境中同步載入 CJS 模組（better-sqlite3 是 CJS）
const require = createRequire(import.meta.url);

// better-sqlite3 型別宣告（套件尚未安裝，用寬鬆介面描述）
interface BetterSqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface BetterSqliteDB {
  prepare(sql: string): BetterSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

// 取得專案根目錄（src/storage/db.ts → 上兩層）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Session 摘要型別 */
export interface SessionSummary {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  totalMessages: number;
  totalHighlights: number;
  snapshotCount: number;
  peakIntensity: number;
  dominantEmotion: string;
  avgIntensity: number;
}

/** Session 列表項目型別 */
export interface SessionListItem {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  totalMessages: number;
  totalHighlights: number;
}

/**
 * SessionDB
 * 管理直播情緒資料的 SQLite 儲存層。
 * 支援快照逐秒寫入、高光標記儲存、Session 索引維護。
 */
export class SessionDB {
  private db: BetterSqliteDB;
  private sessionId: string;
  readonly dbPath: string;

  // Prepared statements（預編譯，加速重複寫入）
  private stmtInsertSnapshot: BetterSqliteStatement;
  private stmtInsertHighlight: BetterSqliteStatement;
  private stmtUpdateSession: BetterSqliteStatement;
  private stmtIncrHighlights: BetterSqliteStatement;

  constructor(dbPath?: string) {
    // 預設資料庫路徑：data/mood-meter.db
    this.dbPath = dbPath ?? path.join(PROJECT_ROOT, 'data', 'mood-meter.db');

    // 自動建立 data/ 目錄（若不存在）
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`[DB] 建立資料目錄：${dataDir}`);
    }

    // 同步載入 better-sqlite3（CJS 套件）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Database = require('better-sqlite3') as new (path: string) => BetterSqliteDB;
    this.db = new Database(this.dbPath);

    // 建立資料表
    this.initSchema();

    // 預編譯常用語句
    this.stmtInsertSnapshot = this.db.prepare(`
      INSERT INTO snapshots
        (session_id, timestamp, dominant, hype, funny, sad, angry, intensity, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtInsertHighlight = this.db.prepare(`
      INSERT INTO highlights
        (session_id, timestamp, emotion, intensity, duration, sample_messages)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpdateSession = this.db.prepare(`
      UPDATE sessions SET ended_at = ?, total_messages = ? WHERE session_id = ?
    `);

    this.stmtIncrHighlights = this.db.prepare(`
      UPDATE sessions SET total_highlights = total_highlights + 1 WHERE session_id = ?
    `);

    // 產生新的 sessionId（ISO 格式，例：2026-03-13T16:57:00.000Z）
    this.sessionId = new Date().toISOString();

    console.log(`[DB] 資料庫已初始化：${this.dbPath}`);
  }

  /** 取得目前 sessionId */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * startSession
   * 在 sessions 表建立新紀錄，標記直播開始時間。
   */
  startSession(): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (session_id, started_at, ended_at, total_messages, total_highlights)
      VALUES (?, ?, NULL, 0, 0)
    `).run(this.sessionId, now);

    console.log(`[DB] Session 開始：${this.sessionId}`);
  }

  /**
   * saveSnapshot
   * 將 EmotionSnapshot 寫入 snapshots 表。
   * 使用 prepared statement 確保高頻率寫入的效能。
   */
  saveSnapshot(snapshot: EmotionSnapshot): void {
    this.stmtInsertSnapshot.run(
      this.sessionId,
      snapshot.timestamp,
      snapshot.dominant,
      snapshot.scores.hype,
      snapshot.scores.funny,
      snapshot.scores.sad,
      snapshot.scores.angry,
      snapshot.intensity,
      snapshot.messageCount,
    );
  }

  /**
   * saveHighlight
   * 將 HighlightMarker 寫入 highlights 表。
   * sampleMessages 序列化為 JSON 字串儲存。
   */
  saveHighlight(marker: HighlightMarker): void {
    this.stmtInsertHighlight.run(
      this.sessionId,
      marker.timestamp,
      marker.emotion,
      marker.intensity,
      marker.duration,
      JSON.stringify(marker.sampleMessages),
    );

    // 更新 session 的 total_highlights 計數
    this.stmtIncrHighlights.run(this.sessionId);
  }

  /**
   * endSession
   * 更新 ended_at 並統計 total_messages（從快照加總）。
   */
  endSession(): void {
    const now = Date.now();

    // 統計此 session 的訊息總數（加總所有快照的 message_count）
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(message_count), 0) as total
      FROM snapshots WHERE session_id = ?
    `).get(this.sessionId) as { total: number };

    this.stmtUpdateSession.run(now, result.total, this.sessionId);
    console.log(`[DB] Session 結束：${this.sessionId}，共 ${result.total} 則訊息`);
  }

  /**
   * getSessionSummary
   * 取得指定 session 的完整摘要，包含統計資訊。
   */
  getSessionSummary(sessionId: string): SessionSummary | null {
    // 取得基本 session 資訊
    const session = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `).get(sessionId) as {
      session_id: string;
      started_at: number;
      ended_at: number | null;
      total_messages: number;
      total_highlights: number;
    } | undefined;

    if (!session) return null;

    // 計算快照統計（數量、峰值、平均強度）
    const stats = this.db.prepare(`
      SELECT
        COUNT(*)       as snapshot_count,
        MAX(intensity) as peak_intensity,
        AVG(intensity) as avg_intensity
      FROM snapshots WHERE session_id = ?
    `).get(sessionId) as {
      snapshot_count: number;
      peak_intensity: number | null;
      avg_intensity: number | null;
    };

    // 找出最常出現的情緒類型
    const dominantRow = this.db.prepare(`
      SELECT dominant, COUNT(*) as cnt
      FROM snapshots WHERE session_id = ?
      GROUP BY dominant ORDER BY cnt DESC LIMIT 1
    `).get(sessionId) as { dominant: string; cnt: number } | undefined;

    return {
      sessionId: session.session_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      totalMessages: session.total_messages,
      totalHighlights: session.total_highlights,
      snapshotCount: stats.snapshot_count,
      peakIntensity: stats.peak_intensity ?? 0,
      dominantEmotion: dominantRow?.dominant ?? 'neutral',
      avgIntensity: Math.round((stats.avg_intensity ?? 0) * 1000) / 1000,
    };
  }

  /**
   * listSessions
   * 列出所有 session，按開始時間降序排列（最新在前）。
   */
  listSessions(): SessionListItem[] {
    const rows = this.db.prepare(`
      SELECT session_id, started_at, ended_at, total_messages, total_highlights
      FROM sessions ORDER BY started_at DESC
    `).all() as Array<{
      session_id: string;
      started_at: number;
      ended_at: number | null;
      total_messages: number;
      total_highlights: number;
    }>;

    return rows.map(r => ({
      sessionId: r.session_id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      totalMessages: r.total_messages,
      totalHighlights: r.total_highlights,
    }));
  }

  /**
   * getSnapshots
   * 取得指定 session 的所有快照（供導出模組使用）。
   */
  getSnapshots(sessionId: string): EmotionSnapshot[] {
    const rows = this.db.prepare(`
      SELECT * FROM snapshots WHERE session_id = ? ORDER BY timestamp ASC
    `).all(sessionId) as Array<{
      timestamp: number;
      dominant: string;
      hype: number;
      funny: number;
      sad: number;
      angry: number;
      intensity: number;
      message_count: number;
    }>;

    return rows.map(r => ({
      timestamp: r.timestamp,
      dominant: r.dominant as EmotionSnapshot['dominant'],
      scores: {
        hype: r.hype ?? 0,
        funny: r.funny ?? 0,
        sad: r.sad ?? 0,
        angry: r.angry ?? 0,
      },
      intensity: r.intensity ?? 0,
      messageCount: r.message_count ?? 0,
    }));
  }

  /**
   * getHighlights
   * 取得指定 session 的所有高光標記（供導出模組使用）。
   */
  getHighlights(sessionId: string): HighlightMarker[] {
    const rows = this.db.prepare(`
      SELECT * FROM highlights WHERE session_id = ? ORDER BY timestamp ASC
    `).all(sessionId) as Array<{
      timestamp: number;
      emotion: string;
      intensity: number;
      duration: number;
      sample_messages: string;
    }>;

    return rows.map(r => ({
      timestamp: r.timestamp,
      emotion: r.emotion as HighlightMarker['emotion'],
      intensity: r.intensity ?? 0,
      duration: r.duration ?? 0,
      sampleMessages: JSON.parse(r.sample_messages ?? '[]') as string[],
    }));
  }

  /** 關閉資料庫連線 */
  close(): void {
    this.db.close();
    console.log('[DB] 資料庫連線已關閉');
  }

  // ──────────────────────────────────────────
  // 內部工具
  // ──────────────────────────────────────────

  /** 初始化資料表 Schema */
  private initSchema(): void {
    this.db.exec(`
      -- 情緒快照（逐秒記錄）
      CREATE TABLE IF NOT EXISTS snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT    NOT NULL,
        timestamp     INTEGER NOT NULL,
        dominant      TEXT    NOT NULL,
        hype          REAL,
        funny         REAL,
        sad           REAL,
        angry         REAL,
        intensity     REAL,
        message_count INTEGER
      );

      -- 高光標記
      CREATE TABLE IF NOT EXISTS highlights (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT    NOT NULL,
        timestamp       INTEGER NOT NULL,
        emotion         TEXT    NOT NULL,
        intensity       REAL,
        duration        INTEGER,
        sample_messages TEXT
      );

      -- Session 索引
      CREATE TABLE IF NOT EXISTS sessions (
        session_id       TEXT PRIMARY KEY,
        started_at       INTEGER,
        ended_at         INTEGER,
        total_messages   INTEGER DEFAULT 0,
        total_highlights INTEGER DEFAULT 0
      );

      -- 為常用查詢建立索引，加速 WHERE session_id = ?
      CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_highlights_session ON highlights(session_id);
    `);
  }
}
