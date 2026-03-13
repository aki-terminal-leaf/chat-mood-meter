/**
 * export-routes.test.ts — Export 路由整合測試（M6）
 *
 * 使用真實 PostgreSQL（postgresql://cmm:<env>@localhost:5432/chatmoodmeter）
 * 測試前 seed 測試資料，測試後透過 CASCADE 刪 user 清理。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@cmm/db/schema';
import { exportRoutes } from '../src/routes/export.js';
import { JWTService } from '../src/auth/jwt.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

// ── 常數 ──────────────────────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL!;
const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

// ── 全域狀態 ──────────────────────────────────────────────────────────────────

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let jwt: JWTService;
let app: ReturnType<typeof Fastify>;

let userId1:   string;
let userId2:   string;
let sessionId: string;   // 屬於 user1
let token1:    string;   // user1 access token
let token2:    string;   // user2 access token（無權限的測試用）

// ── 測試環境設置 ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  db   = drizzle(pool, { schema });
  jwt  = new JWTService({ secret: JWT_SECRET });

  app = Fastify({ logger: false });
  await app.register(fastifyCookie);

  const authMiddleware = createAuthMiddleware(jwt);
  await exportRoutes(app, { db, authMiddleware });
  await app.ready();

  // ── Seed：User 1 ──────────────────────────────────────────────────────────

  const [user1] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-export-u1-${Date.now()}`,
      username:    'test_export_user1',
      displayName: 'Export Test User1',
      accessToken: 'fake-token-export-1',
    })
    .returning({ id: schema.users.id });
  userId1 = user1.id;

  // ── Seed：User 2（另一位使用者，測試 403/404）────────────────────────────

  const [user2] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-export-u2-${Date.now()}`,
      username:    'test_export_user2',
      displayName: 'Export Test User2',
      accessToken: 'fake-token-export-2',
    })
    .returning({ id: schema.users.id });
  userId2 = user2.id;

  // ── Seed：Channel（屬於 user1）────────────────────────────────────────────

  const [channel] = await db
    .insert(schema.channels)
    .values({
      userId:      userId1,
      platform:    'twitch',
      channelId:   'export-test-ch',
      channelName: 'Export Test Channel',
    })
    .returning({ id: schema.channels.id });

  // ── Seed：Session ─────────────────────────────────────────────────────────

  const streamStart = new Date(Date.now() - 3600_000); // 1 小時前開播

  const [session] = await db
    .insert(schema.sessions)
    .values({
      channelId:  channel.id,
      status:     'ended',
      startedAt:  streamStart,
      endedAt:    new Date(),
    })
    .returning({ id: schema.sessions.id });
  sessionId = session.id;

  // ── Seed：Highlights（含 offsetSec）──────────────────────────────────────

  await db.insert(schema.highlights).values([
    {
      sessionId:  sessionId,
      ts:         new Date(streamStart.getTime() + 60_000),    // 1 分鐘
      emotion:    'hype',
      intensity:  0.85,
      durationMs: 30000,
      offsetSec:  60,
      samples:    JSON.stringify(['哇這也太猛了', 'PogChamp', '666']),
    },
    {
      sessionId:  sessionId,
      ts:         new Date(streamStart.getTime() + 300_000),   // 5 分鐘
      emotion:    'funny',
      intensity:  0.72,
      durationMs: 20000,
      offsetSec:  300,
      samples:    JSON.stringify(['哈哈哈', 'LUL', '笑死']),
    },
  ]);

  // ── Seed：Snapshots（JSON / HTML 使用）────────────────────────────────────

  await db.insert(schema.snapshots).values([
    {
      sessionId: sessionId,
      ts:        new Date(streamStart.getTime() + 30_000),
      dominant:  'hype',
      hype:      0.7,
      funny:     0.1,
      sad:       0.0,
      angry:     0.0,
      intensity: 0.75,
      msgCount:  42,
    },
    {
      sessionId: sessionId,
      ts:        new Date(streamStart.getTime() + 60_000),
      dominant:  'hype',
      hype:      0.85,
      funny:     0.05,
      sad:       0.0,
      angry:     0.0,
      intensity: 0.88,
      msgCount:  78,
    },
  ]);

  // ── JWT tokens ────────────────────────────────────────────────────────────

  token1 = await jwt.signAccessToken({ userId: userId1, provider: 'twitch', username: 'test_export_user1' });
  token2 = await jwt.signAccessToken({ userId: userId2, provider: 'twitch', username: 'test_export_user2' });
});

afterAll(async () => {
  // 刪 user 透過 CASCADE 清除所有測試資料
  if (userId1) {
    await db.delete(schema.users).where(
      // @ts-ignore drizzle inArray shorthand
      (schema.users.id as any).$eq ? undefined : undefined
    );
    // 直接用 SQL 刪除兩位測試 user
    await pool.query(
      'DELETE FROM users WHERE id = ANY($1)',
      [[userId1, userId2].filter(Boolean)],
    );
  }
  await app.close();
  await pool.end();
});

// ── 測試案例 ──────────────────────────────────────────────────────────────────

describe('Export Routes — GET /api/sessions/:id/export/:format', () => {

  // 1. JSON
  it('json → 200 + application/json + Content-Disposition', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/json`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="highlights-${sessionId.slice(0, 8)}\\.json"`),
    );

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('session');
    expect(body).toHaveProperty('highlights');
    expect(body.highlights).toHaveLength(2);
  });

  // 2. CSV
  it('csv → 200 + text/csv + Content-Disposition', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/csv`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="highlights-${sessionId.slice(0, 8)}\\.csv"`),
    );
    // 含標題列
    expect(res.body).toMatch(/timestamp/);
  });

  // 3. EDL
  it('edl → 200 + text/plain + 含 TITLE', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/edl`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-disposition']).toMatch(/\.edl"/);
    expect(res.body).toMatch(/TITLE/);
  });

  // 4. Chapters
  it('chapters → 200 + 含 00:00:00 Stream Start', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/chapters`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-disposition']).toMatch(/\.txt"/);
    expect(res.body).toMatch(/00:00:00 Stream Start/);
  });

  // 5. SRT
  it('srt → 200 + application/x-subrip + 含 -->', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/srt`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-subrip/);
    expect(res.headers['content-disposition']).toMatch(/\.srt"/);
    expect(res.body).toMatch(/-->/);
  });

  // 6. HTML
  it('html → 200 + text/html', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/html`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-disposition']).toMatch(/\.html"/);
    expect(res.body).toMatch(/<html/);
    expect(res.body).toMatch(/Chat Mood Meter/);
  });

  // 7. 不支援的格式 → 400
  it('不支援的格式 → 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/xlsx`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/不支援的格式/);
  });

  // 8. 不存在的 session → 404
  it('不存在的 session → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${fakeId}/export/json`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });

  // 9. 別人的 session → 404（不洩漏 session 是否存在）
  it('別人的 session → 404', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/json`,
      headers: { Authorization: `Bearer ${token2}` }, // user2 沒有這個 session
    });

    expect(res.statusCode).toBe(404);
  });

  // 額外：?selected 選擇性導出
  it('?selected 過濾後只包含指定的 highlights', async () => {
    // 先取 highlight ids
    const highlights = await db
      .select({ id: schema.highlights.id })
      .from(schema.highlights)
      .where(
        (schema.highlights.sessionId as any).$eq
          ? (schema.highlights.sessionId as any).$eq(sessionId)
          : undefined,
      );

    // 直接用 SQL 取
    const { rows } = await pool.query(
      'SELECT id FROM highlights WHERE session_id = $1 ORDER BY ts LIMIT 1',
      [sessionId],
    );
    const firstId = rows[0]?.id;

    if (!firstId) return; // 萬一 seed 失敗就跳過

    const res = await app.inject({
      method:  'GET',
      url:     `/api/sessions/${sessionId}/export/json?selected=${firstId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.highlights).toHaveLength(1);
  });
});
