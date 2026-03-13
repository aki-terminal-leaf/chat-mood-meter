/**
 * sessions.ts — Session 路由（完整實作）
 *
 * 路由列表：
 *   GET    /api/sessions                  → 列出當前使用者的場次（含分頁）
 *   GET    /api/sessions/:id              → 場次詳情（含 channel info）
 *   GET    /api/sessions/:id/snapshots    → 場次快照（支援 from/to 時間範圍）
 *   GET    /api/sessions/:id/highlights   → 場次高光（按時間升序）
 *   DELETE /api/sessions/:id             → 刪除場次
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, asc, gte, lte, sql, inArray, type SQL } from 'drizzle-orm';
import * as schema from '@cmm/db/schema';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type DrizzleDB = NodePgDatabase<typeof schema>;
type AuthMiddleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface SessionDeps {
  db: DrizzleDB;
  authMiddleware: AuthMiddleware;
}

// ── 權限檢查 helper ───────────────────────────────────────────────────────────

/**
 * 確認 session 是否屬於指定使用者（透過 channel → user 關係）
 * 若不屬於或 session 不存在，均回傳 false（避免洩漏 session 是否存在）
 */
async function verifySessionOwnership(
  db: DrizzleDB,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.channels, eq(schema.sessions.channelId, schema.channels.id))
    .where(and(
      eq(schema.sessions.id, sessionId),
      eq(schema.channels.userId, userId),
    ))
    .limit(1);
  return result.length > 0;
}

// ── 主路由 ────────────────────────────────────────────────────────────────────

export async function sessionRoutes(
  app: FastifyInstance,
  deps: SessionDeps,
): Promise<void> {
  const { db, authMiddleware } = deps;

  // ── GET /api/sessions ────────────────────────────────────────────────────────
  // 列出使用者的場次，支援分頁與 channelId 篩選
  app.get(
    '/api/sessions',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const query  = request.query as {
        page?:      string;
        limit?:     string;
        channelId?: string;
      };

      const page   = Math.max(1, parseInt(query.page  ?? '1',  10));
      const limit  = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      // 取使用者所有頻道 ID
      const userChannels = await db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(eq(schema.channels.userId, userId));

      const channelIds = userChannels.map(c => c.id);

      if (channelIds.length === 0) {
        return reply.send({
          data:       [],
          pagination: { page, limit, total: 0 },
        });
      }

      // 篩選條件
      let whereClause: SQL | undefined = inArray(schema.sessions.channelId, channelIds);
      if (query.channelId) {
        whereClause = and(whereClause, eq(schema.sessions.channelId, query.channelId));
      }

      // 取總數
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.sessions)
        .where(whereClause);

      // 取分頁資料（join channels 取 channelName / platform）
      const data = await db
        .select({
          id:              schema.sessions.id,
          channelId:       schema.sessions.channelId,
          channelName:     schema.channels.channelName,
          channelPlatform: schema.channels.platform,
          status:          schema.sessions.status,
          startedAt:       schema.sessions.startedAt,
          endedAt:         schema.sessions.endedAt,
          totalMessages:   schema.sessions.totalMessages,
          totalHighlights: schema.sessions.totalHighlights,
          peakIntensity:   schema.sessions.peakIntensity,
          dominantEmotion: schema.sessions.dominantEmotion,
          streamTitle:     schema.sessions.streamTitle,
          createdAt:       schema.sessions.createdAt,
        })
        .from(schema.sessions)
        .innerJoin(schema.channels, eq(schema.sessions.channelId, schema.channels.id))
        .where(whereClause)
        .orderBy(desc(schema.sessions.startedAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data,
        pagination: { page, limit, total: Number(total) },
      });
    },
  );

  // ── GET /api/sessions/:id ────────────────────────────────────────────────────
  // 場次詳情（含 channel info），不屬於當前使用者回傳 404
  app.get(
    '/api/sessions/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };

      const [session] = await db
        .select({
          id:              schema.sessions.id,
          channelId:       schema.sessions.channelId,
          channelName:     schema.channels.channelName,
          channelPlatform: schema.channels.platform,
          status:          schema.sessions.status,
          startedAt:       schema.sessions.startedAt,
          endedAt:         schema.sessions.endedAt,
          totalMessages:   schema.sessions.totalMessages,
          totalHighlights: schema.sessions.totalHighlights,
          peakIntensity:   schema.sessions.peakIntensity,
          peakMsgRate:     schema.sessions.peakMsgRate,
          dominantEmotion: schema.sessions.dominantEmotion,
          streamTitle:     schema.sessions.streamTitle,
          metadata:        schema.sessions.metadata,
          createdAt:       schema.sessions.createdAt,
        })
        .from(schema.sessions)
        .innerJoin(schema.channels, eq(schema.sessions.channelId, schema.channels.id))
        .where(and(
          eq(schema.sessions.id, id),
          eq(schema.channels.userId, userId),
        ))
        .limit(1);

      if (!session) {
        return reply.status(404).send({ error: '場次不存在' });
      }

      return reply.send(session);
    },
  );

  // ── GET /api/sessions/:id/snapshots ─────────────────────────────────────────
  // 場次快照，支援 ?from=&to= 時間範圍篩選（ISO timestamp）
  app.get(
    '/api/sessions/:id/snapshots',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };
      const query  = request.query as { from?: string; to?: string };

      // 權限檢查
      const owned = await verifySessionOwnership(db, id, userId);
      if (!owned) {
        return reply.status(404).send({ error: '場次不存在' });
      }

      // 建立篩選條件
      let whereClause: SQL | undefined = eq(schema.snapshots.sessionId, id);
      if (query.from) {
        whereClause = and(whereClause, gte(schema.snapshots.ts, new Date(query.from)));
      }
      if (query.to) {
        whereClause = and(whereClause, lte(schema.snapshots.ts, new Date(query.to)));
      }

      const data = await db
        .select()
        .from(schema.snapshots)
        .where(whereClause)
        .orderBy(asc(schema.snapshots.ts));

      return reply.send({ data });
    },
  );

  // ── GET /api/sessions/:id/highlights ────────────────────────────────────────
  // 場次高光，按時間升序
  app.get(
    '/api/sessions/:id/highlights',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };

      // 權限檢查
      const owned = await verifySessionOwnership(db, id, userId);
      if (!owned) {
        return reply.status(404).send({ error: '場次不存在' });
      }

      const data = await db
        .select()
        .from(schema.highlights)
        .where(eq(schema.highlights.sessionId, id))
        .orderBy(asc(schema.highlights.ts));

      return reply.send({ data });
    },
  );

  // ── DELETE /api/sessions/:id ─────────────────────────────────────────────────
  // 刪除場次（不屬於當前使用者回傳 404）
  app.delete(
    '/api/sessions/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id } = request.params as { id: string };

      // 先確認 session 屬於當前使用者
      const owned = await verifySessionOwnership(db, id, userId);
      if (!owned) {
        return reply.status(404).send({ error: '場次不存在' });
      }

      const [deleted] = await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .returning({ id: schema.sessions.id });

      return reply.send({ ok: true, deleted: deleted.id });
    },
  );
}
