/**
 * app.test.ts — Fastify App 整合測試
 *
 * 使用 buildApp() 建立測試 app（不 listen），透過 inject() 測試：
 *   1. GET /health → 200 + status ok
 *   2. 未登入存取 /api/sessions → 401
 *   3. 未登入存取 /api/channels → 401
 *
 * 注意：注入 mock pool / db / wsHub，不需要真實 DB / Redis 連線。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildApp } from '../src/index.js';
import type { AppInstance } from '../src/index.js';

// ── Mock 設定 ─────────────────────────────────────────────────────────────────

// Mock config，避免讀 .env（測試環境可能沒有）
vi.mock('../src/config.js', () => ({
  config: {
    port:     3000,
    host:     '0.0.0.0',
    database: { url: 'postgresql://localhost/test' },
    jwt: {
      secret:              'test-jwt-secret-at-least-32-characters!!',
      accessTokenExpiry:   '15m',
      refreshTokenExpiry:  '7d',
    },
    encryption: { key: 'test-encryption-key-change-in-prod' },
    twitch: {
      clientId:    'test_client_id',
      clientSecret:'test_client_secret',
      redirectUri: 'http://localhost:3000/auth/twitch/callback',
    },
    youtube: {
      clientId:    'test_yt_client_id',
      clientSecret:'test_yt_client_secret',
      redirectUri: 'http://localhost:3000/auth/youtube/callback',
    },
    cors:  { origin: 'http://localhost:5173' },
    redis: { url: 'redis://localhost:6379' },
  },
}));

// ── Mock 依賴 ─────────────────────────────────────────────────────────────────

/** 假 DB：回傳空陣列，避免真實 SQL 查詢 */
function makeMockDb() {
  const noop = () => ({
    from:           () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    where:          () => ({ limit: () => Promise.resolve([]) }),
    limit:          () => Promise.resolve([]),
    returning:      () => Promise.resolve([]),
    values:         () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }) }),
    set:            () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    delete:         () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  });
  return {
    select:  noop,
    insert:  () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete:  () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    update:  noop,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** 假 Pool */
function makeMockPool() {
  return { end: vi.fn().mockResolvedValue(undefined) };
}

/** 假 WSHub */
function makeMockWsHub() {
  return {
    register: vi.fn(),
    start:    vi.fn(),
    stop:     vi.fn().mockResolvedValue(undefined),
  };
}

// ── 測試主體 ──────────────────────────────────────────────────────────────────

describe('Fastify App', () => {
  let instance: AppInstance;

  beforeAll(async () => {
    instance = await buildApp({
      logger: false,
      deps: {
        db:    makeMockDb(),
        pool:  makeMockPool(),
        wsHub: makeMockWsHub(),
      },
    });
    // 只呼叫 ready()，不 listen
    await instance.app.ready();
  });

  afterAll(async () => {
    await instance.app.close();
  });

  // ── 測試 1：Health Check ───────────────────────────────────────────────────

  it('GET /health → 200 + status ok', async () => {
    const res = await instance.app.inject({
      method: 'GET',
      url:    '/health',
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBe('0.2.0');
  });

  // ── 測試 2：未登入存取 /api/sessions → 401 ────────────────────────────────

  it('未登入存取 /api/sessions → 401', async () => {
    const res = await instance.app.inject({
      method: 'GET',
      url:    '/api/sessions',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  // ── 測試 3：未登入存取 /api/channels → 401 ────────────────────────────────

  it('未登入存取 /api/channels → 401', async () => {
    const res = await instance.app.inject({
      method: 'GET',
      url:    '/api/channels',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.any(String) });
  });

  // ── 額外：確認 WSHub 有被初始化 ────────────────────────────────────────────

  it('WSHub.register 與 WSHub.start 應被呼叫', () => {
    expect((instance.wsHub as ReturnType<typeof makeMockWsHub>).register).toHaveBeenCalledOnce();
    expect((instance.wsHub as ReturnType<typeof makeMockWsHub>).start).toHaveBeenCalledOnce();
  });
});

// ── Static Serving + SPA Fallback 測試 ───────────────────────────────────────

describe('Static Serving + SPA Fallback', () => {
  let spaInstance: AppInstance;

  // src/index.ts 中，publicDir = path.join(import.meta.dirname, 'public')
  // import.meta.dirname 解析為 src/ 目錄
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const publicDir = path.join(testDir, '../src/public');
  const indexHtml = path.join(publicDir, 'index.html');

  beforeAll(async () => {
    // 建立假的 public/index.html（讓 fastifyStatic 和 SPA fallback 可以正常運作）
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(
      indexHtml,
      '<!DOCTYPE html><html><head><title>Test SPA</title></head><body><div id="root"></div></body></html>',
    );

    spaInstance = await buildApp({
      logger: false,
      deps: {
        db:    makeMockDb(),
        pool:  makeMockPool(),
        wsHub: makeMockWsHub(),
      },
    });
    await spaInstance.app.ready();
  });

  afterAll(async () => {
    await spaInstance.app.close();
    // 清除測試用的假 public 目錄
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  // ── 測試 SPA Fallback ────────────────────────────────────────────────────

  it('GET /nonexistent-page → 應回 index.html（SPA fallback）', async () => {
    const res = await spaInstance.app.inject({
      method: 'GET',
      url:    '/nonexistent-page',
    });

    // SPA fallback 回傳 index.html
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('Test SPA');
  });

  it('GET /some/deep/route → 也應回 index.html（SPA fallback）', async () => {
    const res = await spaInstance.app.inject({
      method: 'GET',
      url:    '/some/deep/route',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<!DOCTYPE html>');
  });

  // ── 測試 /api/* 不走 SPA fallback ────────────────────────────────────────

  it('GET /api/nonexistent → 應回 404 JSON（不走 SPA fallback）', async () => {
    const res = await spaInstance.app.inject({
      method: 'GET',
      url:    '/api/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    // 確認不是 HTML
    expect(res.headers['content-type']).toContain('application/json');
  });

  // ── 測試 /auth/* 不走 SPA fallback ───────────────────────────────────────

  it('GET /auth/nonexistent → 應回 404 JSON（不走 SPA fallback）', async () => {
    const res = await spaInstance.app.inject({
      method: 'GET',
      url:    '/auth/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(res.headers['content-type']).toContain('application/json');
  });
});
