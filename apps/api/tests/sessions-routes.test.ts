/**
 * sessions-routes.test.ts — Sessions 路由整合測試
 *
 * 使用真實 PostgreSQL（postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter）
 * 測試前 seed 測試資料，測試後清除（透過 CASCADE 刪 users 即可）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@cmm/db/schema';
import { sessionRoutes } from '../src/routes/sessions.js';
import { JWTService } from '../src/auth/jwt.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

// ── 常數 ──────────────────────────────────────────────────────────────────────

const DB_URL     = 'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter';
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

// ── 全域狀態 ──────────────────────────────────────────────────────────────────

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let jwt: JWTService;
let app: ReturnType<typeof Fastify>;

let userId1:    string;
let userId2:    string;
let channelId1: string;
let channelId2: string;
let sessionId1: string;
let sessionId2: string;  // 屬於 user2
let token1:     string;  // user1 的 access token
let token2:     string;  // user2 的 access token

// ── 測試環境設置 ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 建立 DB 連線
  pool = new pg.Pool({ connectionString: DB_URL });
  db   = drizzle(pool, { schema });
  jwt  = new JWTService({ secret: JWT_SECRET });

  // 建立 Fastify 實例
  app = Fastify();
  await app.register(fastifyCookie);

  const authMiddleware = createAuthMiddleware(jwt);
  await sessionRoutes(app, { db, authMiddleware });
  await app.ready();

  // ── Seed data ────────────────────────────────────────────────────────────────

  // User 1
  const [user1] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-sessions-user1-${Date.now()}`,
      username:    'test_sessions_user1',
      displayName: 'Test Sessions User1',
      accessToken: 'fake-token-1',
    })
    .returning({ id: schema.users.id });
  userId1 = user1.id;

  // User 2
  const [user2] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-sessions-user2-${Date.now()}`,
      username:    'test_sessions_user2',
      displayName: 'Test Sessions User2',
      accessToken: 'fake-token-2',
    })
    .returning({ id: schema.users.id });
  userId2 = user2.id;

  // Channel for user1
  const [ch1] = await db
    .insert(schema.channels)
    .values({
      userId:      userId1,
      platform:    'twitch',
      channelId:   'twitch_chan_1',
      channelName: 'TestChan1',
      enabled:     true,
      autoStart:   true,
    })
    .returning({ id: schema.channels.id });
  channelId1 = ch1.id;

  // Channel for user2
  const [ch2] = await db
    .insert(schema.channels)
    .values({
      userId:      userId2,
      platform:    'twitch',
      channelId:   'twitch_chan_2',
      channelName: 'TestChan2',
      enabled:     true,
      autoStart:   true,
    })
    .returning({ id: schema.channels.id });
  channelId2 = ch2.id;

  // Session 1 for user1（含 snapshots + highlights）
  const [sess1] = await db
    .insert(schema.sessions)
    .values({
      channelId:       channelId1,
      status:          'ended',
      startedAt:       new Date('2026-01-01T10:00:00Z'),
      endedAt:         new Date('2026-01-01T11:00:00Z'),
      totalMessages:   500,
      totalHighlights: 3,
      dominantEmotion: 'hype',
    })
    .returning({ id: schema.sessions.id });
  sessionId1 = sess1.id;

  // 額外 5 筆 sessions（用於分頁測試），user1 共有 6 筆
  for (let i = 0; i < 5; i++) {
    await db.insert(schema.sessions).values({
      channelId: channelId1,
      status:    'ended',
      startedAt: new Date(`2026-01-0${i + 2}T10:00:00Z`),
    });
  }

  // Session for user2（用於權限測試）
  const [sess2] = await db
    .insert(schema.sessions)
    .values({
      channelId: channelId2,
      status:    'live',
      startedAt: new Date('2026-01-01T09:00:00Z'),
    })
    .returning({ id: schema.sessions.id });
  sessionId2 = sess2.id;

  // Snapshots for session1
  // 注意：snapshot1 在 10:05、snapshot2 在 10:10
  // 時間範圍篩選測試使用 from=10:04 to=10:07，只有 snapshot1 落在範圍內
  await db.insert(schema.snapshots).values([
    {
      sessionId: sessionId1,
      ts:        new Date('2026-01-01T10:05:00Z'),
      dominant:  'hype',
      hype:      0.8,
      funny:     0.1,
      sad:       0.0,
      angry:     0.1,
      intensity: 0.75,
      msgCount:  50,
    },
    {
      sessionId: sessionId1,
      ts:        new Date('2026-01-01T10:10:00Z'),
      dominant:  'funny',
      hype:      0.3,
      funny:     0.6,
      sad:       0.0,
      angry:     0.1,
      intensity: 0.55,
      msgCount:  30,
    },
  ]);

  // Highlights for session1
  await db.insert(schema.highlights).values([
    {
      sessionId:  sessionId1,
      ts:         new Date('2026-01-01T10:06:00Z'),
      emotion:    'hype',
      intensity:  0.9,
      durationMs: 3000,
    },
    {
      sessionId:  sessionId1,
      ts:         new Date('2026-01-01T10:12:00Z'),
      emotion:    'funny',
      intensity:  0.7,
      durationMs: 2000,
    },
  ]);

  // 產生 JWT tokens
  token1 = await jwt.signAccessToken({ userId: userId1, provider: 'twitch', username: 'test_sessions_user1' });
  token2 = await jwt.signAccessToken({ userId: userId2, provider: 'twitch', username: 'test_sessions_user2' });
});

afterAll(async () => {
  // 透過 CASCADE 刪 users，會自動清除所有關聯資料
  if (userId1 || userId2) {
    await pool.query(
      'DELETE FROM users WHERE id = ANY($1::uuid[])',
      [[userId1, userId2].filter(Boolean)],
    );
  }
  await app.close();
  await pool.end();
});

// ── 測試 ──────────────────────────────────────────────────────────────────────

describe('GET /api/sessions', () => {
  it('應回傳使用者的 sessions 列表（預設降序）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/sessions',
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    // user1 有 session1 + 5 個額外 sessions = 6 筆（預設 limit=20）
    expect(body.data.length).toBe(6);
    // 應按 startedAt 降序
    const dates = body.data.map((s: any) => new Date(s.startedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('應支援分頁（limit=2, page=1）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/sessions?limit=2&page=1',
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 2 });
  });

  it('應支援 page=2，且兩頁資料不重複', async () => {
    const res1 = await app.inject({
      method:  'GET',
      url:     '/api/sessions?limit=2&page=1',
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res2 = await app.inject({
      method:  'GET',
      url:     '/api/sessions?limit=2&page=2',
      headers: { Authorization: `Bearer ${token1}` },
    });

    const page1Ids = res1.json().data.map((s: any) => s.id);
    const page2Ids = res2.json().data.map((s: any) => s.id);
    const overlap  = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('應支援 channelId 篩選', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions?channelId=${channelId1}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((s: any) => {
      expect(s.channelId).toBe(channelId1);
    });
  });

  it('沒有 token 時回傳 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/sessions/:id', () => {
  it('應回傳場次詳情（含 channel info）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId1}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(sessionId1);
    expect(body).toHaveProperty('channelName');
    expect(body).toHaveProperty('channelPlatform');
    expect(body.totalMessages).toBe(500);
  });

  it('存取別人的 session 應回傳 404', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId2}`,
      headers: { Authorization: `Bearer ${token1}` },  // user1 存取 user2 的 session
    });

    expect(res.statusCode).toBe(404);
  });

  it('不存在的 session 應回傳 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${fakeId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/sessions/:id/snapshots', () => {
  it('應回傳場次的所有 snapshots（按時間升序）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId1}/snapshots`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    // 確認升序
    const ts = body.data.map((s: any) => new Date(s.ts).getTime());
    expect(ts[0]).toBeLessThan(ts[1]);
  });

  it('應支援時間範圍篩選（from/to）', async () => {
    // snapshots 在 10:05 (hype) 和 10:10 (funny)
    // from=10:04 to=10:07 → 只有 10:05 的 hype snapshot 落在範圍內
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId1}/snapshots?from=2026-01-01T10:04:00Z&to=2026-01-01T10:07:00Z`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].dominant).toBe('hype');
  });

  it('存取別人的 session snapshots 應回傳 404', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId2}/snapshots`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/sessions/:id/highlights', () => {
  it('應回傳場次的所有 highlights（按時間升序）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId1}/highlights`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    // 確認升序
    const ts = body.data.map((h: any) => new Date(h.ts).getTime());
    expect(ts[0]).toBeLessThan(ts[1]);
  });

  it('存取別人的 session highlights 應回傳 404', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId2}/highlights`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('應成功刪除場次', async () => {
    // 先建一個要刪的 session
    const [tmpSession] = await db
      .insert(schema.sessions)
      .values({
        channelId: channelId1,
        status:    'ended',
        startedAt: new Date('2026-03-01T00:00:00Z'),
      })
      .returning({ id: schema.sessions.id });

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/sessions/${tmpSession.id}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deleted: tmpSession.id });

    // 確認真的刪了
    const check = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${tmpSession.id}`,
      headers: { Authorization: `Bearer ${token1}` },
    });
    expect(check.statusCode).toBe(404);
  });

  it('刪除別人的 session 應回傳 404', async () => {
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/sessions/${sessionId2}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('刪除不存在的 session 應回傳 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/sessions/${fakeId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
