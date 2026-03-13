/**
 * webhooks-routes.test.ts — Webhook 路由整合測試
 *
 * 使用 Fastify inject + JWT auth，不需要真實 DB（in-memory store）。
 * 每個 test file 在獨立 vitest worker 執行，webhooks Map 是全新的。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { webhookRoutes } from '../src/routes/webhooks.js';
import { JWTService } from '../src/auth/jwt.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

// ── 常數 ──────────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

// ── 全域狀態 ──────────────────────────────────────────────────────────────────

let jwt: JWTService;
let app: ReturnType<typeof Fastify>;

let token1: string;
let token2: string;
let userId1: string;
let userId2: string;

// 跨測試追蹤已建立的 webhook ID
let createdWebhookId: string;
let anotherWebhookId: string;  // user1 的另一個 webhook，用於驗證 user2 無法刪除

// ── 測試環境設置 ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  jwt = new JWTService({ secret: JWT_SECRET });

  // 用獨特的 UUID 避免測試間干擾
  userId1 = crypto.randomUUID();
  userId2 = crypto.randomUUID();

  app = Fastify({ logger: false });
  await app.register(fastifyCookie);

  const authMiddleware = createAuthMiddleware(jwt);
  await webhookRoutes(app, { authMiddleware });
  await app.ready();

  token1 = await jwt.signAccessToken({ userId: userId1, provider: 'twitch', username: 'user1' });
  token2 = await jwt.signAccessToken({ userId: userId2, provider: 'twitch', username: 'user2' });
});

afterAll(async () => {
  await app.close();
});

// ── 測試 ──────────────────────────────────────────────────────────────────────

describe('GET /api/webhooks', () => {
  it('1. 初始狀態應回傳空陣列', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/webhooks',
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/webhooks', () => {
  it('2. 提供合法資料應建立成功（201）', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url:    'https://example.com/webhook',
        events: ['highlight.created'],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('id');
    expect(body.url).toBe('https://example.com/webhook');
    expect(body.events).toContain('highlight.created');
    expect(body.userId).toBe(userId1);
    expect(body.active).toBe(true);

    // 儲存以便後續測試使用
    createdWebhookId = body.id;
  });

  it('3. 缺少 url → 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: ['highlight.created'] }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('4. 缺少 events → 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/webhook' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('5. events 含無效事件 → 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url:    'https://example.com/webhook',
        events: ['highlight.created', 'invalid.event'],
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('invalid.event');
  });
});

describe('GET /api/webhooks（建立後）', () => {
  it('6. 建立後應能列出自己的 webhook', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/webhooks',
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((w: any) => w.id === createdWebhookId);
    expect(found).toBeDefined();
    expect(found!.userId).toBe(userId1);
  });

  it('6b. user2 應只看到自己的 webhook（初始為空）', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/webhooks',
      headers: { Authorization: `Bearer ${token2}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // user2 尚未建立任何 webhook
    expect(body.every((w: any) => w.userId === userId2)).toBe(true);
  });
});

describe('PATCH /api/webhooks/:id', () => {
  it('7. 更新 active 狀態應成功', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/webhooks/${createdWebhookId}`,
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ active: false }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);
  });

  it('7b. 更新別人的 webhook → 404', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/webhooks/${createdWebhookId}`,
      headers: {
        Authorization:  `Bearer ${token2}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ active: true }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('7c. 更新不存在的 webhook → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/webhooks/${fakeId}`,
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ active: true }),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/webhooks/:id', () => {
  beforeAll(async () => {
    // 預先為 user1 建立另一個 webhook，用於測試 user2 無法刪除
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: {
        Authorization:  `Bearer ${token1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url:    'https://example.com/webhook-for-delete-test',
        events: ['session.started', 'session.ended'],
      }),
    });
    anotherWebhookId = res.json().id;
  });

  it('8. 刪除自己的 webhook 應成功', async () => {
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/webhooks/${anotherWebhookId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
  });

  it('9. 刪除不存在的 webhook → 404', async () => {
    // anotherWebhookId 已被刪除，再刪一次應 404
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/webhooks/${anotherWebhookId}`,
      headers: { Authorization: `Bearer ${token1}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('10. 刪除別人的 webhook → 404', async () => {
    // createdWebhookId 是 user1 的，user2 嘗試刪除
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/webhooks/${createdWebhookId}`,
      headers: { Authorization: `Bearer ${token2}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('未帶 token', () => {
  it('11. GET /api/webhooks 無 token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/webhooks',
    });

    expect(res.statusCode).toBe(401);
  });

  it('11b. POST /api/webhooks 無 token → 401', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/webhooks',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: 'https://example.com', events: ['highlight.created'] }),
    });

    expect(res.statusCode).toBe(401);
  });

  it('11c. DELETE /api/webhooks/:id 無 token → 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/webhooks/${createdWebhookId}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
