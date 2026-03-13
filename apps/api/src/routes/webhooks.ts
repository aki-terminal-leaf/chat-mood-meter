import type { FastifyInstance } from 'fastify';

// 需要在 DB schema 加 webhooks 表，但 M9 先用 in-memory 簡化
// 之後再 migrate

export interface WebhookConfig {
  id: string;
  userId: string;
  url: string;
  events: string[]; // ['highlight.created', 'session.started', 'session.ended']
  active: boolean;
  createdAt: string;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// In-memory store（之後改 DB）
const webhooks = new Map<string, WebhookConfig>();

export async function webhookRoutes(app: FastifyInstance, deps: { authMiddleware: any }) {
  const { authMiddleware } = deps;

  // GET /api/webhooks — 列出使用者的 webhooks
  app.get('/api/webhooks', { preHandler: authMiddleware }, async (req) => {
    const userId = (req as any).user!.userId;
    return Array.from(webhooks.values()).filter(w => w.userId === userId);
  });

  // POST /api/webhooks — 建立 webhook
  app.post('/api/webhooks', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user!.userId;
    const { url, events } = req.body as { url: string; events: string[] };

    if (!url || !events?.length) {
      return reply.status(400).send({ error: '需要 url 和 events' });
    }

    // 基本 URL 格式驗證
    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: '無效的 URL 格式' });
    }

    // 驗證 events 是否合法
    const VALID_EVENTS = ['highlight.created', 'session.started', 'session.ended'];
    const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return reply.status(400).send({
        error: `不支援的事件類型：${invalidEvents.join(', ')}`,
        validEvents: VALID_EVENTS,
      });
    }

    const id = crypto.randomUUID();
    const webhook: WebhookConfig = {
      id,
      userId,
      url,
      events,
      active: true,
      createdAt: new Date().toISOString(),
    };
    webhooks.set(id, webhook);
    return reply.status(201).send(webhook);
  });

  // PATCH /api/webhooks/:id — 更新（啟用 / 停用）
  app.patch('/api/webhooks/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user!.userId;
    const { id } = req.params as { id: string };
    const wh = webhooks.get(id);

    if (!wh || wh.userId !== userId) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const { active } = req.body as { active?: boolean };
    if (typeof active === 'boolean') {
      wh.active = active;
      webhooks.set(id, wh);
    }
    return wh;
  });

  // DELETE /api/webhooks/:id
  app.delete('/api/webhooks/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user!.userId;
    const { id } = req.params as { id: string };
    const wh = webhooks.get(id);

    if (!wh || wh.userId !== userId) {
      return reply.status(404).send({ error: 'Not found' });
    }

    webhooks.delete(id);
    return { success: true };
  });

  // POST /api/webhooks/test — 測試發送（送一筆假 payload）
  app.post('/api/webhooks/:id/test', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user!.userId;
    const { id } = req.params as { id: string };
    const wh = webhooks.get(id);

    if (!wh || wh.userId !== userId) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const testPayload: WebhookPayload = {
      event: 'highlight.created',
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        emotion: 'hype',
        intensity: 0.85,
        channelName: 'test-channel',
        offsetSec: 120,
      },
    };

    const ok = await sendWebhook(wh.url, testPayload);
    return { success: ok, message: ok ? '測試推送成功' : '推送失敗，請確認 URL 可正常接收 POST 請求' };
  });
}

// ─────────────────────────────────────────────
// Webhook 發送函式（供 worker 呼叫）
// ─────────────────────────────────────────────

/**
 * 向指定 URL 發送 webhook payload
 * 5 秒 timeout，失敗回傳 false（不拋錯）
 */
export async function sendWebhook(url: string, payload: WebhookPayload): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CMM-Event': payload.event,
        'X-CMM-Timestamp': payload.timestamp,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5 秒 timeout
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 廣播事件給所有訂閱該 userId 且 active 的 webhooks
 * 並行發送，失敗靜默（不影響主流程）
 */
export async function broadcastWebhookEvent(
  userId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const targets = Array.from(webhooks.values()).filter(
    w => w.userId === userId && w.active && w.events.includes(event),
  );

  // 並行發送，不等待結果（fire-and-forget）
  Promise.allSettled(targets.map(w => sendWebhook(w.url, payload))).catch(() => {});
}
