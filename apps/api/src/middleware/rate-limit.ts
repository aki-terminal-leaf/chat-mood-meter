/**
 * rate-limit.ts — In-memory Sliding Window Rate Limiter
 *
 * 以 userId（已登入）或 IP（未登入）為 key，
 * 在 windowMs 毫秒內最多允許 maxRequests 次請求。
 *
 * 適合單機部署；水平擴展時請換成 Redis-based 方案。
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimitConfig {
  /** 時間窗口（毫秒），預設 60000（1 分鐘） */
  windowMs: number;
  /** 窗口內最大請求數，預設 100 */
  maxRequests: number;
}

export function createRateLimiter(config?: Partial<RateLimitConfig>) {
  const windowMs    = config?.windowMs    ?? 60_000;
  const maxRequests = config?.maxRequests ?? 100;

  // key → 該時間窗口內的請求時間戳陣列
  const hits = new Map<string, number[]>();

  // 定期清理過期記錄，避免 Map 無限成長
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, windowMs);

  // Node.js 不會因 setInterval 阻擋 process 結束，但測試環境可能需要手動清理
  // 使用 unref() 確保不阻擋程序退出
  if (timer.unref) timer.unref();

  /**
   * 回傳清理函式，測試時可手動呼叫釋放 timer
   */
  const cleanup = () => clearInterval(timer);

  const middleware = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = (request.user as { userId?: string } | undefined)?.userId ?? request.ip ?? 'unknown';
    const now = Date.now();
    const timestamps = hits.get(key) ?? [];
    const valid = timestamps.filter(t => now - t < windowMs);

    if (valid.length >= maxRequests) {
      reply.header('Retry-After', Math.ceil(windowMs / 1000));
      await reply.status(429).send({ error: 'Too many requests' });
      return;
    }

    valid.push(now);
    hits.set(key, valid);

    reply.header('X-RateLimit-Limit',     maxRequests);
    reply.header('X-RateLimit-Remaining', maxRequests - valid.length);
  };

  // 把 cleanup 掛在 middleware 上，方便測試環境存取
  (middleware as typeof middleware & { cleanup: () => void }).cleanup = cleanup;

  return middleware as typeof middleware & { cleanup: () => void };
}
