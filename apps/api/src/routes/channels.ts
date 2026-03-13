/**
 * channels.ts — Channel 路由（完整實作）
 *
 * 路由列表：
 *   GET    /api/channels        → 列出當前使用者的頻道
 *   POST   /api/channels        → 新增頻道
 *   PATCH  /api/channels/:id    → 更新頻道設定（enabled, autoStart, analyzerMode, channelName）
 *   DELETE /api/channels/:id    → 刪除頻道（CASCADE 刪 sessions/snapshots/highlights）
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@cmm/db/schema';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type DrizzleDB = NodePgDatabase<typeof schema>;
type AuthMiddleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface ChannelDeps {
  db: DrizzleDB;
  authMiddleware: AuthMiddleware;
}

/** PostgreSQL 唯一衝突錯誤碼 */
const PG_UNIQUE_VIOLATION = '23505';

// ── 主路由 ────────────────────────────────────────────────────────────────────

export async function channelRoutes(
  app: FastifyInstance,
  deps: ChannelDeps,
): Promise<void> {
  const { db, authMiddleware } = deps;

  // ── GET /api/channels ─────────────────────────────────────────────────────
  // 列出使用者所有頻道
  app.get(
    '/api/channels',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;

      const data = await db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.userId, userId));

      return reply.send({ data });
    },
  );

  // ── POST /api/channels ────────────────────────────────────────────────────
  // 新增頻道
  app.post(
    '/api/channels',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const body   = request.body as {
        platform?:     string;
        channelId?:    string;
        channelName?:  string;
        enabled?:      boolean;
        autoStart?:    boolean;
        analyzerMode?: string;
      };

      // 驗證必要欄位
      if (!body?.platform || !body?.channelId || !body?.channelName) {
        return reply.status(400).send({
          error: '缺少必要欄位：platform、channelId、channelName',
        });
      }

      try {
        const [created] = await db
          .insert(schema.channels)
          .values({
            userId,
            platform:     body.platform,
            channelId:    body.channelId,
            channelName:  body.channelName,
            enabled:      body.enabled      ?? true,
            autoStart:    body.autoStart    ?? true,
            analyzerMode: body.analyzerMode ?? 'rules',
          })
          .returning();

        return reply.status(201).send(created);
      } catch (err: any) {
        const code = err?.code ?? err?.cause?.code;
        const msg = String(err?.message ?? '');
        if (code === PG_UNIQUE_VIOLATION || msg.includes('duplicate key')) {
          return reply.status(409).send({ error: '該頻道已存在' });
        }
        throw err;
      }
    },
  );

  // ── PATCH /api/channels/:id ───────────────────────────────────────────────
  // 更新頻道設定，只更新屬於自己的頻道
  app.patch(
    '/api/channels/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };
      const body   = request.body as {
        enabled?:      boolean;
        autoStart?:    boolean;
        analyzerMode?: string;
        channelName?:  string;
      };

      // 至少需要一個可更新欄位
      const hasField = [
        body?.enabled      !== undefined,
        body?.autoStart    !== undefined,
        body?.analyzerMode !== undefined,
        body?.channelName  !== undefined,
      ].some(Boolean);

      if (!hasField) {
        return reply.status(400).send({ error: '沒有可更新的欄位' });
      }

      const updates: Partial<typeof schema.channels.$inferInsert> = {};
      if (body.enabled      !== undefined) updates.enabled      = body.enabled;
      if (body.autoStart    !== undefined) updates.autoStart    = body.autoStart;
      if (body.analyzerMode !== undefined) updates.analyzerMode = body.analyzerMode;
      if (body.channelName  !== undefined) updates.channelName  = body.channelName;

      const [updated] = await db
        .update(schema.channels)
        .set(updates)
        .where(and(
          eq(schema.channels.id,     id),
          eq(schema.channels.userId, userId),
        ))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: '頻道不存在或無權限' });
      }

      return reply.send(updated);
    },
  );

  // ── DELETE /api/channels/:id ──────────────────────────────────────────────
  // 刪除頻道（DB CASCADE 自動刪除關聯的 sessions/snapshots/highlights）
  app.delete(
    '/api/channels/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };

      const [deleted] = await db
        .delete(schema.channels)
        .where(and(
          eq(schema.channels.id,     id),
          eq(schema.channels.userId, userId),
        ))
        .returning({ id: schema.channels.id });

      if (!deleted) {
        return reply.status(404).send({ error: '頻道不存在或無權限' });
      }

      return reply.send({ ok: true, deleted: deleted.id });
    },
  );
}
