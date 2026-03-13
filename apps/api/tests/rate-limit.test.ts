/**
 * rate-limit.test.ts — Sliding Window Rate Limiter 測試
 *
 * 測試：
 *   1. 正常請求 → 通過 + 正確 header（X-RateLimit-Limit, X-RateLimit-Remaining）
 *   2. 超過限制 → 429 + Retry-After header
 *   3. 窗口過期後重新允許
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { createRateLimiter } from '../src/middleware/rate-limit.js';

// ── 工具函式 ──────────────────────────────────────────────────────────────────

/**
 * 建立帶有 rate limiter 的測試用 Fastify instance。
 * 每個測試獨立建立，避免 hit 計數互相干擾。
 */
function makeApp(opts?: { windowMs?: number; maxRequests?: number }) {
  const app     = Fastify({ logger: false });
  const limiter = createRateLimiter(opts);

  app.get(
    '/test',
    { preHandler: limiter },
    async () => ({ ok: true }),
  );

  return { app, limiter };
}

// ── 測試區塊 ──────────────────────────────────────────────────────────────────

describe('Rate Limiter — 正常請求', () => {
  let app: ReturnType<typeof Fastify>;
  let limiter: ReturnType<typeof createRateLimiter>;

  afterEach(async () => {
    limiter.cleanup();
    await app.close();
  });

  it('第一次請求應通過，回傳 X-RateLimit-Limit 與 X-RateLimit-Remaining', async () => {
    ({ app, limiter } = makeApp({ windowMs: 60_000, maxRequests: 5 }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    // 已用 1 次，剩 4
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
  });

  it('多次請求應正確遞減 X-RateLimit-Remaining', async () => {
    ({ app, limiter } = makeApp({ windowMs: 60_000, maxRequests: 10 }));
    await app.ready();

    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/test' });
    }

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
    // 已用 4 次，剩 6
    expect(res.headers['x-ratelimit-remaining']).toBe('6');
  });
});

describe('Rate Limiter — 超過限制', () => {
  let app: ReturnType<typeof Fastify>;
  let limiter: ReturnType<typeof createRateLimiter>;

  afterEach(async () => {
    limiter.cleanup();
    await app.close();
  });

  it('超過 maxRequests 後應回傳 429 + Retry-After', async () => {
    const maxRequests = 3;
    const windowMs    = 60_000;
    ({ app, limiter } = makeApp({ windowMs, maxRequests }));
    await app.ready();

    // 耗盡配額
    for (let i = 0; i < maxRequests; i++) {
      const r = await app.inject({ method: 'GET', url: '/test' });
      expect(r.statusCode).toBe(200);
    }

    // 第 4 次應被拒絕
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'Too many requests' });

    // 應有 Retry-After header（單位秒）
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(Math.ceil(windowMs / 1000));
  });

  it('超過限制後連續請求都應回傳 429', async () => {
    ({ app, limiter } = makeApp({ windowMs: 60_000, maxRequests: 2 }));
    await app.ready();

    // 耗盡
    await app.inject({ method: 'GET', url: '/test' });
    await app.inject({ method: 'GET', url: '/test' });

    // 後續請求都是 429
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'GET', url: '/test' });
      expect(r.statusCode).toBe(429);
    }
  });
});

describe('Rate Limiter — 窗口過期後重新允許', () => {
  it('窗口過期後請求計數應重置', async () => {
    // 使用超短窗口（50ms）方便測試
    const windowMs    = 50;
    const maxRequests = 2;
    const { app, limiter } = makeApp({ windowMs, maxRequests });
    await app.ready();

    // 耗盡配額
    await app.inject({ method: 'GET', url: '/test' });
    await app.inject({ method: 'GET', url: '/test' });

    // 確認已被限制
    const blocked = await app.inject({ method: 'GET', url: '/test' });
    expect(blocked.statusCode).toBe(429);

    // 等待窗口過期
    await new Promise(resolve => setTimeout(resolve, windowMs + 20));

    // 窗口過期後應重新允許
    const allowed = await app.inject({ method: 'GET', url: '/test' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['x-ratelimit-remaining']).toBe(String(maxRequests - 1));

    limiter.cleanup();
    await app.close();
  });
});
