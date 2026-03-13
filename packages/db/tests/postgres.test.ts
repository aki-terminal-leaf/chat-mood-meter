/**
 * postgres.test.ts
 * PostgresDB 整合測試：使用真實 PostgreSQL，驗證所有 CRUD 操作。
 *
 * 需要執行中的 PostgreSQL：
 *   postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter
 *
 * 執行方式：
 *   pnpm test --run packages/db/tests/postgres.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { PostgresDB } from '../src/postgres.js';
import { BatchWriter } from '../src/batch-writer.js';
import * as schema from '../src/schema.js';
import type { EmotionSnapshot, HighlightMarker } from '@cmm/core/types';

// ─── 測試常數 ────────────────────────────────────────────────

const DB_URL = 'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter';

// ─── 工具函式 ────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<EmotionSnapshot>): EmotionSnapshot {
  return {
    timestamp: Date.now(),
    dominant: 'hype',
    scores: { hype: 0.7, funny: 0.1, sad: 0.05, angry: 0.05 },
    intensity: 0.7,
    messageCount: 10,
    ...overrides,
  };
}

function makeHighlight(overrides?: Partial<HighlightMarker>): HighlightMarker {
  return {
    timestamp: Date.now(),
    emotion: 'hype',
    intensity: 0.85,
    duration: 30_000,
    sampleMessages: ['msg1', 'msg2'],
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('PostgresDB', () => {
  /** 測試用 pg Pool（直接連線，用於 setup/teardown） */
  let adminPool: Pool;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;

  /** 測試用 channelId（每次 beforeAll 建立） */
  let testChannelId: string;
  let testUserId: string;

  /** 每個測試的 PostgresDB 實例 */
  let db: PostgresDB;

  // ── 測試前建立基礎資料 ─────────────────────────────────────

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: DB_URL });
    adminDb = drizzle(adminPool, { schema });

    // 清空測試資料（按 FK 順序刪除）
    await adminDb.delete(schema.highlights);
    await adminDb.delete(schema.snapshots);
    await adminDb.delete(schema.sessions);
    await adminDb.delete(schema.channels);
    await adminDb.delete(schema.users);

    // 建立測試用 user
    const [user] = await adminDb
      .insert(schema.users)
      .values({
        provider: 'twitch',
        providerId: 'test_user_001',
        username: 'test_streamer',
        displayName: '測試主播',
        accessToken: 'encrypted_dummy_token',
      })
      .returning({ id: schema.users.id });
    testUserId = user.id;

    // 建立測試用 channel
    const [channel] = await adminDb
      .insert(schema.channels)
      .values({
        userId: testUserId,
        platform: 'twitch',
        channelId: 'test_channel_001',
        channelName: 'test_channel',
      })
      .returning({ id: schema.channels.id });
    testChannelId = channel.id;
  });

  afterAll(async () => {
    // 清理測試資料
    await adminDb.delete(schema.highlights);
    await adminDb.delete(schema.snapshots);
    await adminDb.delete(schema.sessions);
    await adminDb.delete(schema.channels);
    await adminDb.delete(schema.users);

    await adminPool.end();
  });

  beforeEach(async () => {
    // 每個測試清空 sessions/snapshots/highlights，保留 user/channel
    await adminDb.delete(schema.highlights);
    await adminDb.delete(schema.snapshots);
    await adminDb.delete(schema.sessions);

    // 建立新的 PostgresDB 實例
    db = new PostgresDB(DB_URL, testChannelId);
  });

  // ─────────────────────────────────────────────────────────────

  // ── getSessionId() ─────────────────────────────────────────

  describe('getSessionId()', () => {
    it('startSession 前呼叫應拋錯', () => {
      expect(() => db.getSessionId()).toThrow();
    });

    it('startSession 後回傳非空字串', async () => {
      await db.startSession();
      const id = db.getSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      await db.close();
    });

    it('sessionId 格式為 UUID', async () => {
      await db.startSession();
      const id = db.getSessionId();
      // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      await db.close();
    });
  });

  // ── startSession() ─────────────────────────────────────────

  describe('startSession()', () => {
    it('應在 sessions 表建立紀錄', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      const rows = await adminDb
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('live');
      expect(rows[0].channelId).toBe(testChannelId);
      await db.close();
    });

    it('初始 totalMessages=0、totalHighlights=0', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      const [row] = await adminDb
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(row.totalMessages).toBe(0);
      expect(row.totalHighlights).toBe(0);
      await db.close();
    });
  });

  // ── saveSnapshot() ─────────────────────────────────────────

  describe('saveSnapshot()', () => {
    it('寫入後可在 snapshots 表查到', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      await db.saveSnapshot(makeSnapshot());

      const rows = await adminDb
        .select()
        .from(schema.snapshots)
        .where(eq(schema.snapshots.sessionId, sessionId));

      expect(rows.length).toBe(1);
      await db.close();
    });

    it('欄位值正確對應', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      const ts = Date.now();
      await db.saveSnapshot(makeSnapshot({
        timestamp: ts,
        dominant: 'funny',
        intensity: 0.65,
        messageCount: 12,
        scores: { hype: 0.1, funny: 0.65, sad: 0.1, angry: 0.15 },
      }));

      const [row] = await adminDb
        .select()
        .from(schema.snapshots)
        .where(eq(schema.snapshots.sessionId, sessionId));

      expect(row.dominant).toBe('funny');
      expect(row.intensity).toBeCloseTo(0.65);
      expect(row.msgCount).toBe(12);
      expect(row.funny).toBeCloseTo(0.65);
      // ts 從 Date 轉回 unix ms 誤差 < 1000ms（timestamp 精度）
      expect(Math.abs(row.ts.getTime() - ts)).toBeLessThan(1000);
      await db.close();
    });
  });

  // ── saveHighlight() ────────────────────────────────────────

  describe('saveHighlight()', () => {
    it('寫入後可在 highlights 表查到', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      await db.saveHighlight(makeHighlight());

      const rows = await adminDb
        .select()
        .from(schema.highlights)
        .where(eq(schema.highlights.sessionId, sessionId));

      expect(rows.length).toBe(1);
      await db.close();
    });

    it('欄位值正確對應', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      const samples = ['hello', 'world'];
      await db.saveHighlight(makeHighlight({
        emotion: 'angry',
        intensity: 0.92,
        duration: 25_000,
        sampleMessages: samples,
      }));

      const [row] = await adminDb
        .select()
        .from(schema.highlights)
        .where(eq(schema.highlights.sessionId, sessionId));

      expect(row.emotion).toBe('angry');
      expect(row.intensity).toBeCloseTo(0.92);
      expect(row.durationMs).toBe(25_000);
      expect(row.samples).toEqual(samples);
      await db.close();
    });

    it('呼叫後 totalHighlights 遞增', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      await db.saveHighlight(makeHighlight());
      await db.saveHighlight(makeHighlight());

      const [row] = await adminDb
        .select({ th: schema.sessions.totalHighlights })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(row.th).toBe(2);
      await db.close();
    });
  });

  // ── endSession() ───────────────────────────────────────────

  describe('endSession()', () => {
    it('更新 status 為 ended', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      await db.endSession();

      const [row] = await adminDb
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(row.status).toBe('ended');
      expect(row.endedAt).not.toBeNull();
      await db.close();
    });

    it('totalMessages 從 snapshots 加總', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      await db.saveSnapshot(makeSnapshot({ messageCount: 10 }));
      await db.saveSnapshot(makeSnapshot({ messageCount: 20 }));
      await db.saveSnapshot(makeSnapshot({ messageCount: 5 }));
      await db.endSession();

      const [row] = await adminDb
        .select({ tm: schema.sessions.totalMessages })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(row.tm).toBe(35);
      await db.close();
    });

    it('peakIntensity 為快照最大值', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      await db.saveSnapshot(makeSnapshot({ intensity: 0.5 }));
      await db.saveSnapshot(makeSnapshot({ intensity: 0.95 }));
      await db.saveSnapshot(makeSnapshot({ intensity: 0.7 }));
      await db.endSession();

      const [row] = await adminDb
        .select({ pi: schema.sessions.peakIntensity })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      expect(row.pi).toBeCloseTo(0.95);
      await db.close();
    });
  });

  // ── listSessions() ─────────────────────────────────────────

  describe('listSessions()', () => {
    it('無 session 時回傳空陣列', async () => {
      const sessions = await db.listSessions();
      expect(sessions).toEqual([]);
      await db.close();
    });

    it('startSession 後列出一筆', async () => {
      await db.startSession();
      const sessions = await db.listSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe(db.getSessionId());
      await db.close();
    });

    it('startedAt / endedAt 轉為 unix ms', async () => {
      await db.startSession();
      await db.endSession();

      const sessions = await db.listSessions();
      expect(typeof sessions[0].startedAt).toBe('number');
      expect(typeof sessions[0].endedAt).toBe('number');
      await db.close();
    });

    it('多筆按 startedAt 降序排列', async () => {
      // 先建立第一個 session
      await db.startSession();
      await db.endSession();
      await db.close();

      // 等待 1ms 確保時間戳不同
      await new Promise(r => setTimeout(r, 10));

      // 第二個 session
      const db2 = new PostgresDB(DB_URL, testChannelId);
      await db2.startSession();
      await db2.close();

      const sessions = await new PostgresDB(DB_URL, testChannelId).listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].startedAt).toBeGreaterThan(sessions[1].startedAt);
    });
  });

  // ── getSessionSummary() ────────────────────────────────────

  describe('getSessionSummary()', () => {
    it('找不到時回傳 null', async () => {
      const result = await db.getSessionSummary('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
      await db.close();
    });

    it('回傳正確摘要', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      await db.saveSnapshot(makeSnapshot({ dominant: 'hype', intensity: 0.8, messageCount: 10 }));
      await db.saveSnapshot(makeSnapshot({ dominant: 'hype', intensity: 0.6, messageCount: 5 }));
      await db.saveHighlight(makeHighlight());
      await db.endSession();

      const summary = await db.getSessionSummary(sessionId);
      expect(summary).not.toBeNull();
      expect(summary!.sessionId).toBe(sessionId);
      expect(summary!.snapshotCount).toBe(2);
      expect(summary!.totalHighlights).toBe(1);
      expect(summary!.dominantEmotion).toBe('hype');
      expect(summary!.peakIntensity).toBeCloseTo(0.8);
      expect(summary!.avgIntensity).toBeCloseTo(0.7);
      await db.close();
    });
  });

  // ── getSnapshots() ─────────────────────────────────────────

  describe('getSnapshots()', () => {
    it('回傳快照陣列，按 ts 升序', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      const base = Date.now();

      await db.saveSnapshot(makeSnapshot({ timestamp: base + 2000 }));
      await db.saveSnapshot(makeSnapshot({ timestamp: base + 1000 }));
      await db.saveSnapshot(makeSnapshot({ timestamp: base }));

      const snaps = await db.getSnapshots(sessionId);
      expect(snaps.length).toBe(3);
      expect(snaps[0].timestamp).toBeLessThan(snaps[1].timestamp);
      expect(snaps[1].timestamp).toBeLessThan(snaps[2].timestamp);
      await db.close();
    });

    it('session 不存在時回傳空陣列', async () => {
      const snaps = await db.getSnapshots('00000000-0000-0000-0000-000000000000');
      expect(snaps).toEqual([]);
      await db.close();
    });

    it('EmotionSnapshot 欄位正確對應', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      await db.saveSnapshot(makeSnapshot({
        dominant: 'sad',
        intensity: 0.3,
        messageCount: 7,
        scores: { hype: 0.1, funny: 0.05, sad: 0.3, angry: 0.05 },
      }));

      const [snap] = await db.getSnapshots(sessionId);
      expect(snap.dominant).toBe('sad');
      expect(snap.intensity).toBeCloseTo(0.3);
      expect(snap.messageCount).toBe(7);
      expect(snap.scores.sad).toBeCloseTo(0.3);
      await db.close();
    });
  });

  // ── getHighlights() ────────────────────────────────────────

  describe('getHighlights()', () => {
    it('回傳高光陣列，按 ts 升序', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      const base = Date.now();

      await db.saveHighlight(makeHighlight({ timestamp: base + 2000 }));
      await db.saveHighlight(makeHighlight({ timestamp: base + 1000 }));
      await db.saveHighlight(makeHighlight({ timestamp: base }));

      const highlights = await db.getHighlights(sessionId);
      expect(highlights.length).toBe(3);
      expect(highlights[0].timestamp).toBeLessThan(highlights[1].timestamp);
      await db.close();
    });

    it('HighlightMarker 欄位正確對應', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();
      const samples = ['test1', 'test2', 'test3'];
      await db.saveHighlight(makeHighlight({
        emotion: 'funny',
        intensity: 0.88,
        duration: 45_000,
        sampleMessages: samples,
      }));

      const [hl] = await db.getHighlights(sessionId);
      expect(hl.emotion).toBe('funny');
      expect(hl.intensity).toBeCloseTo(0.88);
      expect(hl.duration).toBe(45_000);
      expect(hl.sampleMessages).toEqual(samples);
      await db.close();
    });
  });

  // ── BatchWriter 整合 ───────────────────────────────────────

  describe('BatchWriter flush 行為（搭配 PostgresDB）', () => {
    it('flush 後 snapshots 寫入 DB', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      const writer = new BatchWriter(db, { flushIntervalMs: 60_000 });
      writer.addSnapshot(sessionId, makeSnapshot({ dominant: 'hype' }));
      writer.addSnapshot(sessionId, makeSnapshot({ dominant: 'funny' }));

      // 手動 flush
      await writer.flush();

      const snaps = await db.getSnapshots(sessionId);
      expect(snaps.length).toBe(2);

      await writer.destroy();
      await db.close();
    });

    it('destroy 時自動 flush 殘留資料', async () => {
      await db.startSession();
      const sessionId = db.getSessionId();

      const writer = new BatchWriter(db, { flushIntervalMs: 60_000 });
      writer.addSnapshot(sessionId, makeSnapshot());
      writer.addHighlight(sessionId, makeHighlight());

      // 不手動 flush，只 destroy
      await writer.destroy();

      const snaps = await db.getSnapshots(sessionId);
      const highlights = await db.getHighlights(sessionId);
      expect(snaps.length).toBe(1);
      expect(highlights.length).toBe(1);

      await db.close();
    });
  });

  // ── close() ────────────────────────────────────────────────

  describe('close()', () => {
    it('關閉後不拋錯', async () => {
      await db.startSession();
      await expect(db.close()).resolves.not.toThrow();
    });
  });
});
