/**
 * index.ts — API Server 主入口
 *
 * 把所有模組接在一起，支援依賴注入（opts.deps）方便測試環境使用。
 */

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';

import { config } from './config.js';
import { JWTService } from './auth/jwt.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { channelRoutes } from './routes/channels.js';
import { workerRoutes } from './routes/workers.js';
import { exportRoutes } from './routes/export.js';
import { WSHub } from './ws-hub.js';
import * as schema from '@cmm/db/schema';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type DrizzleDB = NodePgDatabase<typeof schema>;

/** 可注入的外部依賴（測試時替換，避免實際連線 DB / Redis） */
interface ExternalDeps {
  pool?: Pool | { end: () => Promise<void> };
  db?: DrizzleDB;
  wsHub?: {
    register: (app: FastifyInstance) => void;
    start:    () => void;
    stop:     () => Promise<void>;
  };
}

export interface BuildAppOptions {
  /** 是否啟用 Fastify logger，測試時建議關閉 */
  logger?: boolean;
  /** 依賴注入（測試用），省略時使用真實 DB / Redis */
  deps?: ExternalDeps;
}

export interface AppInstance {
  app:      FastifyInstance;
  db:       DrizzleDB;
  pool:     Pool | { end: () => Promise<void> };
  wsHub:    ExternalDeps['wsHub'] & object;
  shutdown: () => Promise<void>;
}

// ── buildApp ──────────────────────────────────────────────────────────────────

export async function buildApp(opts?: BuildAppOptions): Promise<AppInstance> {
  const app = Fastify({ logger: opts?.logger ?? true });

  // ── 插件 ──────────────────────────────────────────────────────────────────
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin:      config.cors.origin,
    credentials: true,
  });
  await app.register(fastifyWebsocket);

  // ── 資料庫 ────────────────────────────────────────────────────────────────
  const pool: Pool | { end: () => Promise<void> } =
    opts?.deps?.pool ?? new Pool({ connectionString: config.database.url });

  const db: DrizzleDB =
    opts?.deps?.db ?? drizzle(pool as Pool, { schema });

  // ── Auth ───────────────────────────────────────────────────────────────────
  const jwt            = new JWTService(config.jwt);
  const authMiddleware = createAuthMiddleware(jwt);

  // ── 路由 ───────────────────────────────────────────────────────────────────
  await authRoutes(app,    { jwt, db, encryptionKey: config.encryption.key });
  await sessionRoutes(app, { db, authMiddleware });
  await channelRoutes(app, { db, authMiddleware });
  await workerRoutes(app,  { authMiddleware, getWorkerStats: () => [] });
  await exportRoutes(app,  {});   // M6 實作

  // ── WebSocket Hub ──────────────────────────────────────────────────────────
  const wsHub: ExternalDeps['wsHub'] & object =
    opts?.deps?.wsHub ?? new WSHub(config.redis.url);

  wsHub.register(app);
  wsHub.start();

  // ── Health Check ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:    'ok',
    timestamp: new Date().toISOString(),
    version:   '0.2.0',
  }));

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    await wsHub.stop();
    await pool.end();
    await app.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  return { app, db, pool, wsHub, shutdown };
}

// ── 直接執行（非 import） ─────────────────────────────────────────────────────

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { app } = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[API] Server listening on ${config.host}:${config.port}`);
}
