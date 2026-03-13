/**
 * channels-routes.test.ts — Channels 路由整合測試
 *
 * 使用真實 PostgreSQL（postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter）
 * 測試 CRUD 操作與權限控制
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@cmm/db/schema';
import { channelRoutes } from '../src/routes/channels.js';
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
let channelId1: string;  // user1 的頻道（用於更新 / 刪除測試）
let token1:     string;
let token2:     string;

// ── 測試環境設置 ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  db   = drizzle(pool, { schema });
  jwt  = new JWTService({ secret: JWT_SECRET });

  app = Fastify();
  await app.register(fastifyCookie);

  const authMiddleware = createAuthMiddleware(jwt);
  await channelRoutes(app, { db, authMiddleware });
  await app.ready();

  // User 1
  const [u1] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-channels-u1-${Date.now()}`,
      username:    'test_channels_user1',
      displayName: 'Test Channels User1',
      accessToken: 'fake-token-ch1',
    })
    .returning({ id: schema.users.id });
  userId1 = u1.id;

  // User 2
  const [u2] = await db
    .insert(schema.users)
    .values({
      provider:    'twitch',
      providerId:  `test-channels-u2-${Date.now()}`,
      username:    'test_channels_user2',
      displayName: 'Test Channels User2',
      accessToken: 'fake-token-ch2',
    })
    .returning({ id: schema.users.id });
  userId2 = u2.id;

  // user1 已有一個頻道（用於測試）
  const [ch1] = await db
    .insert(schema.channels)
    .values({
      userId:       userId1,
      platform:     'twitch',
      channelId:    'existing_chan_1',
      channelName:  'ExistingChan1',
      enabled:      true,
      autoStart:    true,
      analyzerMode: 'rules',
    })
    .returning({ id: schema.channels.id });
  channelId1 = ch1.id;

  token1 = await jwt.signAccessToken({ userId: userId1, provider: 'twitch', username: 'test_channels_user1' });
  token2 = await jwt.signAccessToken({ userId: userId2, provider: 'twitch', username: 'test_channels_user2' });
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

describe('GET /api/channels', () => {
  it('應回傳使用者的頻道列表', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/channels',
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    // 確認都是屬於自己的
    body.data.forEach((ch: any) => {
      expect(ch).toHaveProperty('id');
      expect(ch).toHaveProperty('platform');
      expect(ch).toHaveProperty('channelName');
    });
  });

  it('user2 只能看到自己的頻道（初始為空）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/channels',
      headers: { Authorization: `Bearer ${token2}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it('沒有 token 時回傳 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/channels' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/channels', () => {
  it('應成功新增頻道', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/channels',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform:    'youtube',
        channelId:   'yt_new_chan_001',
        channelName: 'My YouTube Channel',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.platform).toBe('youtube');
    expect(body.channelId).toBe('yt_new_chan_001');
    expect(body.channelName).toBe('My YouTube Channel');
    expect(body.userId).toBe(userId1);

    // 清理新增的頻道
    await pool.query('DELETE FROM channels WHERE id = $1', [body.id]);
  });

  it('缺少必要欄位應回傳 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/channels',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'youtube',
        // 缺少 channelId 和 channelName
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('重複的頻道應回傳 409', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/channels',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        platform:    'twitch',
        channelId:   'existing_chan_1',  // 已存在
        channelName: 'ExistingChan1',
      }),
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /api/channels/:id', () => {
  it('應成功更新頻道設定', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/channels/${channelId1}`,
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled:      false,
        analyzerMode: 'ai',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.analyzerMode).toBe('ai');
  });

  it('沒有可更新欄位應回傳 400', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/channels/${channelId1}`,
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('更新別人的頻道應回傳 404', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/channels/${channelId1}`,
      headers: {
        Authorization:  `Bearer ${token2}`,  // user2 嘗試改 user1 的頻道
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('更新不存在的頻道應回傳 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/channels/${fakeId}`,
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/channels/:id', () => {
  it('應成功刪除頻道', async () => {
    // 先建立一個要刪的頻道
    const [tmpCh] = await db
      .insert(schema.channels)
      .values({
        userId:      userId1,
        platform:    'youtube',
        channelId:   'to_delete_chan',
        channelName: 'ToDeleteChan',
      })
      .returning({ id: schema.channels.id });

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/channels/${tmpCh.id}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deleted: tmpCh.id });

    // 確認真的刪了
    const check = await app.inject({
      method:  'GET',
      url:     '/api/channels',
      headers: { Authorization: `Bearer ${token1}` },
    });
    const ids = check.json().data.map((ch: any) => ch.id);
    expect(ids).not.toContain(tmpCh.id);
  });

  it('刪除別人的頻道應回傳 404', async () => {
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/channels/${channelId1}`,
      headers: { Authorization: `Bearer ${token2}` },  // user2 嘗試刪 user1 的頻道
    });

    expect(res.statusCode).toBe(404);
  });

  it('刪除不存在的頻道應回傳 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000098';
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/channels/${fakeId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
