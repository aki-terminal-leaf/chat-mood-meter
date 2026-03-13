/**
 * workers.ts — Worker 管理路由（完整實作）
 *
 * 路由列表：
 *   GET  /api/workers        → 列出目前運行中的 worker 狀態
 *   POST /api/workers/start  → 手動開始分析（body: { channelId }）
 *   POST /api/workers/stop   → 手動停止分析（body: { channelId }）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type AuthMiddleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface WorkerStats {
  workerId:  string;
  channelId: string;
  status:    'running' | 'stopped' | 'error';
  startedAt?: string;
}

interface WorkerDeps {
  authMiddleware: AuthMiddleware;
  getWorkerStats: () => WorkerStats[];
  startWorker:    (channelId: string, userId: string) => Promise<void>;
  stopWorker:     (channelId: string) => Promise<void>;
}

// ── 主路由 ────────────────────────────────────────────────────────────────────

export async function workerRoutes(
  app: FastifyInstance,
  deps: WorkerDeps,
): Promise<void> {
  const { authMiddleware, getWorkerStats, startWorker, stopWorker } = deps;

  // ── GET /api/workers ──────────────────────────────────────────────────────
  // 列出目前所有 worker 的狀態
  app.get(
    '/api/workers',
    { preHandler: authMiddleware },
    async (_request, reply) => {
      return reply.send({ workers: getWorkerStats() });
    },
  );

  // ── POST /api/workers/start ───────────────────────────────────────────────
  // 手動觸發指定頻道的分析 worker
  app.post(
    '/api/workers/start',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const body   = request.body as { channelId?: string };

      if (!body?.channelId) {
        return reply.status(400).send({ error: '缺少必要欄位：channelId' });
      }

      try {
        await startWorker(body.channelId, userId);
        return reply.send({ ok: true, channelId: body.channelId });
      } catch (err: any) {
        return reply
          .status(500)
          .send({ error: err?.message ?? 'Worker 啟動失敗' });
      }
    },
  );

  // ── POST /api/workers/stop ────────────────────────────────────────────────
  // 手動停止指定頻道的 worker
  app.post(
    '/api/workers/stop',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as { channelId?: string };

      if (!body?.channelId) {
        return reply.status(400).send({ error: '缺少必要欄位：channelId' });
      }

      try {
        await stopWorker(body.channelId);
        return reply.send({ ok: true, channelId: body.channelId });
      } catch (err: any) {
        return reply
          .status(500)
          .send({ error: err?.message ?? 'Worker 停止失敗' });
      }
    },
  );
}
