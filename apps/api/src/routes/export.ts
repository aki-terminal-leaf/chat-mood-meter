/**
 * export.ts — Export 路由（M6 完整實作）
 *
 * GET /api/sessions/:id/export/:format
 * 支援格式：json, csv, edl, chapters, srt, html
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@cmm/db/schema';
import {
  exportJSON, exportCSV, exportEDL,
  exportChapters, exportSRT, exportHTML,
  type ExportOptions,
} from '@cmm/export';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type DrizzleDB = NodePgDatabase<typeof schema>;
type AuthMiddleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

// ── 常數 ──────────────────────────────────────────────────────────────────────

const VALID_FORMATS = ['json', 'csv', 'edl', 'chapters', 'srt', 'html'] as const;
type ExportFormat = typeof VALID_FORMATS[number];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  json:     'application/json',
  csv:      'text/csv',
  edl:      'text/plain',
  chapters: 'text/plain',
  srt:      'application/x-subrip',
  html:     'text/html',
};

const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  json:     'json',
  csv:      'csv',
  edl:      'edl',
  chapters: 'txt',
  srt:      'srt',
  html:     'html',
};

// ── 主路由 ────────────────────────────────────────────────────────────────────

export async function exportRoutes(
  app: FastifyInstance,
  deps: { db: DrizzleDB; authMiddleware: AuthMiddleware },
): Promise<void> {
  const { db, authMiddleware } = deps;

  // GET /api/sessions/:id/export/:format
  app.get(
    '/api/sessions/:id/export/:format',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { id, format } = request.params as { id: string; format: string };
      const { selected } = request.query as { selected?: string }; // 逗號分隔的 highlight ids

      // 驗證格式
      if (!VALID_FORMATS.includes(format as ExportFormat)) {
        return reply.status(400).send({ error: `不支援的格式: ${format}` });
      }

      // 權限檢查（session 必須屬於當前使用者）
      const sessionRows = await db
        .select({
          id:          schema.sessions.id,
          startedAt:   schema.sessions.startedAt,
          channelName: schema.channels.channelName,
        })
        .from(schema.sessions)
        .innerJoin(schema.channels, eq(schema.sessions.channelId, schema.channels.id))
        .where(and(
          eq(schema.sessions.id, id),
          eq(schema.channels.userId, userId),
        ))
        .limit(1);

      if (sessionRows.length === 0) {
        return reply.status(404).send({ error: 'Session 不存在或無權限' });
      }

      const session = sessionRows[0];

      // 取得 highlights
      let highlightRows = await db
        .select()
        .from(schema.highlights)
        .where(eq(schema.highlights.sessionId, id));

      // 支援選擇性導出（?selected=id1,id2,id3）
      if (selected) {
        const selectedIds = selected.split(',').map(s => Number(s.trim())).filter(Boolean);
        highlightRows = highlightRows.filter(h => selectedIds.includes(h.id));
      }

      // 取得 snapshots（JSON / HTML 才需要）
      let snapshotRows: (typeof schema.snapshots.$inferSelect)[] | undefined;
      if (format === 'json' || format === 'html') {
        snapshotRows = await db
          .select()
          .from(schema.snapshots)
          .where(eq(schema.snapshots.sessionId, id));
      }

      // 建立 ExportOptions（欄位對應 HighlightMarker / EmotionSnapshot）
      const opts: ExportOptions = {
        sessionId:      id,
        streamStartedAt: new Date(session.startedAt).getTime(),
        highlights: highlightRows.map(h => ({
          timestamp:      new Date(h.ts).getTime(),
          emotion:        h.emotion as ExportOptions['highlights'][number]['emotion'],
          intensity:      h.intensity,
          duration:       h.durationMs ?? 30000,
          sampleMessages: (h.samples as string[]) ?? [],
        })),
        snapshots: snapshotRows?.map(s => ({
          timestamp:    new Date(s.ts).getTime(),
          dominant:     s.dominant as ExportOptions['snapshots'] extends Array<infer T> ? T['dominant'] : never,
          scores: {
            hype:  s.hype  ?? 0,
            funny: s.funny ?? 0,
            sad:   s.sad   ?? 0,
            angry: s.angry ?? 0,
          },
          intensity:    s.intensity    ?? 0,
          messageCount: s.msgCount ?? 0,
        })),
      };

      // 呼叫對應的導出函式
      const exporters: Record<ExportFormat, (o: ExportOptions) => string> = {
        json:     exportJSON,
        csv:      exportCSV,
        edl:      exportEDL,
        chapters: exportChapters,
        srt:      exportSRT,
        html:     exportHTML,
      };

      const result   = exporters[format as ExportFormat](opts);
      const ext      = FILE_EXTENSIONS[format as ExportFormat];
      const filename = `highlights-${id.slice(0, 8)}.${ext}`;

      reply.header('Content-Type',        CONTENT_TYPES[format as ExportFormat]);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(result);
    },
  );
}
