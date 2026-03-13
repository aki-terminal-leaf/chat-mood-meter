/**
 * postgres.ts — PostgreSQL 資料庫層（M2）
 *
 * 使用 Drizzle ORM + node-postgres，實作 DBRepository 介面。
 * 與 SQLite 版本邏輯對應，所有方法皆為 async。
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql, asc, desc } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema.js';
import type { DBRepository, SessionSummary, SessionListItem } from './repository.js';
import type { EmotionSnapshot, HighlightMarker } from '@cmm/core/types';

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

/** 批次插入 snapshot 的參數型別 */
export interface SnapshotBatchItem {
  sessionId: string;
  snapshot: EmotionSnapshot;
}

/** 批次插入 highlight 的參數型別 */
export interface HighlightBatchItem {
  sessionId: string;
  highlight: HighlightMarker;
}

/**
 * PostgresDB
 * 實作 DBRepository 介面，底層使用 Drizzle ORM + PostgreSQL。
 * 所有方法皆為 async，回傳 Promise。
 *
 * 注意：DBRepository 的 void 方法型別在 TypeScript 中可接受 Promise<void>，
 * 但讀取方法（listSessions 等）透過非同步覆寫方式提供。
 * 上層若使用 await 呼叫即可正常運作。
 */
export class PostgresDB implements AsyncDBRepository {
  private pool: Pool;
  private db: DrizzleDB;
  private currentSessionId: string | null = null;

  /**
   * @param databaseUrl - PostgreSQL 連線字串（e.g. postgresql://user:pass@host:5432/db）
   * @param channelId   - 此 PostgresDB 實例綁定的 channel UUID（sessions 表需要）
   */
  constructor(
    databaseUrl: string,
    private channelId: string,
  ) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool, { schema });
  }

  // ── Session 管理 ──────────────────────────────────────────

  /** 取得目前 sessionId（UUID 字串），尚未 startSession 時拋錯 */
  getSessionId(): string {
    if (!this.currentSessionId) {
      throw new Error('[PostgresDB] 尚未開始 session，請先呼叫 startSession()');
    }
    return this.currentSessionId;
  }

  /**
   * 在 sessions 表建立新紀錄，設定 status='live'。
   * 會將產生的 UUID 存入 currentSessionId。
   */
  async startSession(): Promise<void> {
    const [session] = await this.db
      .insert(schema.sessions)
      .values({
        channelId: this.channelId,
        startedAt: new Date(),
        status: 'live',
        totalMessages: 0,
        totalHighlights: 0,
        peakIntensity: 0,
        peakMsgRate: 0,
      })
      .returning({ id: schema.sessions.id });

    this.currentSessionId = session.id;
    console.log(`[PostgresDB] Session 開始：${this.currentSessionId}`);
  }

  /**
   * 結束目前 session：更新 ended_at、status='ended'，
   * 並從 snapshots 統計 total_messages / peak_intensity / dominant_emotion。
   */
  async endSession(): Promise<void> {
    const sessionId = this.getSessionId();
    const now = new Date();

    // 從 snapshots 統計數字
    const stats = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.snapshots.msgCount}), 0)`,
        peakIntensity: sql<number>`COALESCE(MAX(${schema.snapshots.intensity}), 0)`,
      })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.sessionId, sessionId));

    // 找出最常出現的情緒
    const dominantRows = await this.db
      .select({
        dominant: schema.snapshots.dominant,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.sessionId, sessionId))
      .groupBy(schema.snapshots.dominant)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(1);

    const totalMessages = Number(stats[0]?.total ?? 0);
    const peakIntensity = Number(stats[0]?.peakIntensity ?? 0);
    const dominantEmotion = dominantRows[0]?.dominant ?? 'neutral';

    await this.db
      .update(schema.sessions)
      .set({
        endedAt: now,
        status: 'ended',
        totalMessages,
        peakIntensity,
        dominantEmotion,
      })
      .where(eq(schema.sessions.id, sessionId));

    console.log(`[PostgresDB] Session 結束：${sessionId}，共 ${totalMessages} 則訊息`);
  }

  // ── 寫入 ──────────────────────────────────────────────────

  /**
   * 儲存一筆情緒快照（立即寫入 PostgreSQL）。
   * 高頻率寫入場景建議使用 BatchWriter。
   */
  async saveSnapshot(snapshot: EmotionSnapshot): Promise<void> {
    const sessionId = this.getSessionId();
    await this.db.insert(schema.snapshots).values({
      sessionId,
      ts: new Date(snapshot.timestamp),
      dominant: snapshot.dominant,
      hype: snapshot.scores.hype,
      funny: snapshot.scores.funny,
      sad: snapshot.scores.sad,
      angry: snapshot.scores.angry,
      intensity: snapshot.intensity,
      msgCount: snapshot.messageCount,
    });
  }

  /**
   * 儲存一筆高光標記（立即寫入 PostgreSQL）。
   * 同時更新 session.total_highlights + 1。
   */
  async saveHighlight(marker: HighlightMarker): Promise<void> {
    const sessionId = this.getSessionId();

    await this.db.insert(schema.highlights).values({
      sessionId,
      ts: new Date(marker.timestamp),
      emotion: marker.emotion,
      intensity: marker.intensity,
      durationMs: marker.duration,
      samples: marker.sampleMessages,
    });

    // 更新 session 的高光計數
    await this.db
      .update(schema.sessions)
      .set({
        totalHighlights: sql`${schema.sessions.totalHighlights} + 1`,
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  // ── 批次寫入（供 BatchWriter 使用）────────────────────────

  /**
   * 批次插入多筆 snapshots，減少 round-trip 次數。
   */
  async batchInsertSnapshots(items: SnapshotBatchItem[]): Promise<void> {
    if (items.length === 0) return;

    const values = items.map(({ sessionId, snapshot }) => ({
      sessionId,
      ts: new Date(snapshot.timestamp),
      dominant: snapshot.dominant,
      hype: snapshot.scores.hype,
      funny: snapshot.scores.funny,
      sad: snapshot.scores.sad,
      angry: snapshot.scores.angry,
      intensity: snapshot.intensity,
      msgCount: snapshot.messageCount,
    }));

    await this.db.insert(schema.snapshots).values(values);
  }

  /**
   * 批次插入多筆 highlights，減少 round-trip 次數。
   */
  async batchInsertHighlights(items: HighlightBatchItem[]): Promise<void> {
    if (items.length === 0) return;

    const values = items.map(({ sessionId, highlight }) => ({
      sessionId,
      ts: new Date(highlight.timestamp),
      emotion: highlight.emotion,
      intensity: highlight.intensity,
      durationMs: highlight.duration,
      samples: highlight.sampleMessages,
    }));

    await this.db.insert(schema.highlights).values(values);

    // 批次更新 totalHighlights（按 sessionId 分組計數）
    const countBySession = items.reduce<Record<string, number>>((acc, { sessionId }) => {
      acc[sessionId] = (acc[sessionId] ?? 0) + 1;
      return acc;
    }, {});

    for (const [sessionId, count] of Object.entries(countBySession)) {
      await this.db
        .update(schema.sessions)
        .set({
          totalHighlights: sql`${schema.sessions.totalHighlights} + ${count}`,
        })
        .where(eq(schema.sessions.id, sessionId));
    }
  }

  // ── 讀取 ──────────────────────────────────────────────────

  /**
   * 列出所有 sessions（按 startedAt 降序）。
   */
  async listSessions(): Promise<SessionListItem[]> {
    const rows = await this.db
      .select({
        id: schema.sessions.id,
        startedAt: schema.sessions.startedAt,
        endedAt: schema.sessions.endedAt,
        totalMessages: schema.sessions.totalMessages,
        totalHighlights: schema.sessions.totalHighlights,
      })
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.startedAt));

    return rows.map(r => ({
      sessionId: r.id,
      startedAt: r.startedAt.getTime(),
      endedAt: r.endedAt ? r.endedAt.getTime() : null,
      totalMessages: r.totalMessages ?? 0,
      totalHighlights: r.totalHighlights ?? 0,
    }));
  }

  /**
   * 取得指定 session 的完整摘要。
   * 找不到時回傳 null。
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    const sessionRows = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (sessionRows.length === 0) return null;
    const session = sessionRows[0];

    // 快照統計
    const statsRows = await this.db
      .select({
        snapshotCount: sql<number>`COUNT(*)`,
        peakIntensity: sql<number>`COALESCE(MAX(${schema.snapshots.intensity}), 0)`,
        avgIntensity: sql<number>`COALESCE(AVG(${schema.snapshots.intensity}), 0)`,
      })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.sessionId, sessionId));

    // 主要情緒
    const dominantRows = await this.db
      .select({
        dominant: schema.snapshots.dominant,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.sessionId, sessionId))
      .groupBy(schema.snapshots.dominant)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(1);

    const stats = statsRows[0];

    return {
      sessionId: session.id,
      startedAt: session.startedAt.getTime(),
      endedAt: session.endedAt ? session.endedAt.getTime() : null,
      totalMessages: session.totalMessages ?? 0,
      totalHighlights: session.totalHighlights ?? 0,
      snapshotCount: Number(stats?.snapshotCount ?? 0),
      peakIntensity: Number(stats?.peakIntensity ?? 0),
      dominantEmotion: dominantRows[0]?.dominant ?? 'neutral',
      avgIntensity: Math.round(Number(stats?.avgIntensity ?? 0) * 1000) / 1000,
    };
  }

  /**
   * 取得指定 session 的所有快照（按時間升序）。
   */
  async getSnapshots(sessionId: string): Promise<EmotionSnapshot[]> {
    const rows = await this.db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.sessionId, sessionId))
      .orderBy(asc(schema.snapshots.ts));

    return rows.map(r => ({
      timestamp: r.ts.getTime(),
      dominant: r.dominant as EmotionSnapshot['dominant'],
      scores: {
        hype: r.hype ?? 0,
        funny: r.funny ?? 0,
        sad: r.sad ?? 0,
        angry: r.angry ?? 0,
      },
      intensity: r.intensity ?? 0,
      messageCount: r.msgCount ?? 0,
    }));
  }

  /**
   * 取得指定 session 的所有高光標記（按時間升序）。
   */
  async getHighlights(sessionId: string): Promise<HighlightMarker[]> {
    const rows = await this.db
      .select()
      .from(schema.highlights)
      .where(eq(schema.highlights.sessionId, sessionId))
      .orderBy(asc(schema.highlights.ts));

    return rows.map(r => ({
      timestamp: r.ts.getTime(),
      emotion: r.emotion as HighlightMarker['emotion'],
      intensity: r.intensity,
      duration: r.durationMs ?? 0,
      sampleMessages: Array.isArray(r.samples) ? (r.samples as string[]) : [],
    }));
  }

  // ── 生命週期 ──────────────────────────────────────────────

  /** 關閉 pg Pool，釋放所有連線 */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('[PostgresDB] 連線池已關閉');
  }
}

/**
 * AsyncDBRepository
 * DBRepository 的非同步版本，供 PostgresDB 實作。
 * 所有方法回傳 Promise，適用於 PostgreSQL 等非同步資料庫。
 */
export interface AsyncDBRepository {
  getSessionId(): string;
  startSession(): Promise<void>;
  endSession(): Promise<void>;
  saveSnapshot(snapshot: EmotionSnapshot): Promise<void>;
  saveHighlight(marker: HighlightMarker): Promise<void>;
  listSessions(): Promise<SessionListItem[]>;
  getSessionSummary(sessionId: string): Promise<SessionSummary | null>;
  getSnapshots(sessionId: string): Promise<EmotionSnapshot[]>;
  getHighlights(sessionId: string): Promise<HighlightMarker[]>;
  close(): Promise<void>;
}
