// ── chat-mood-meter Worker Entry Point ──────────────────────────
import 'dotenv/config';
import IORedis from 'ioredis';
import { WorkerPool } from './pool.js';
import { createJobProcessor } from './queue.js';
import type { ChannelJob } from './queue.js';

// ── Config ───────────────────────────────────────────────────────

/** 從環境變數讀取 Worker 設定，未設定時回傳開發用預設值 */
export function loadWorkerConfig() {
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
}

// ── Job Handlers ─────────────────────────────────────────────────

/** 建立「啟動 channel」的 job 處理函式 */
export function createStartHandler(pool: WorkerPool) {
  return async (job: ChannelJob): Promise<void> => {
    console.log(`[Worker] Start job: ${job.channelId} (${job.platform})`);
    try {
      await pool.spawn({
        channelId: job.channelId,
        platform: job.platform,
        channelName: job.channelName,
        userId: job.userId,
        liveChatId: job.liveChatId,
      } as any);
    } catch (err) {
      console.error(`[Worker] Failed to spawn ${job.channelId}:`, err);
      throw err;
    }
  };
}

/** 建立「停止 channel」的 job 處理函式 */
export function createStopHandler(pool: WorkerPool) {
  return async (job: ChannelJob): Promise<void> => {
    console.log(`[Worker] Stop job: ${job.channelId}`);
    await pool.kill(job.channelId, 'job:stop');
  };
}

// ── Graceful Shutdown ─────────────────────────────────────────────

/** 優雅關閉：停止健康檢查 → 殺掉所有 worker → 關閉 BullMQ processor → 關閉 Redis */
export async function shutdown(
  signal: string,
  pool: WorkerPool,
  processor: { close(): Promise<void> },
  redis: { quit(): Promise<string> },
): Promise<void> {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  pool.stopHealthCheck();
  await pool.killAll('shutdown');
  await processor.close();
  await redis.quit();
  console.log('[Worker] Shutdown complete.');
  process.exit(0);
}

// ── Bootstrap ────────────────────────────────────────────────────

const { databaseUrl, redisUrl } = loadWorkerConfig();

console.log('[Worker] Starting...');
console.log(`[Worker] Database: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
console.log(`[Worker] Redis: ${redisUrl}`);

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // BullMQ 要求
});

const pool = new WorkerPool(
  { maxConcurrent: 100, healthCheckIntervalMs: 60_000 },
  (_workerConfig) => ({
    redis,
    databaseUrl,
  } as any),
);

pool.startHealthCheck();

const processor = createJobProcessor(
  redis,
  createStartHandler(pool),
  createStopHandler(pool),
);

process.on('SIGTERM', () => void shutdown('SIGTERM', pool, processor, redis));
process.on('SIGINT', () => void shutdown('SIGINT', pool, processor, redis));

console.log('[Worker] Ready. Waiting for jobs...');
