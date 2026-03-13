// ── chat-mood-meter Worker Entry Point ──────────────────────────
import 'dotenv/config';
import IORedis from 'ioredis';
import { WorkerPool } from './pool.js';
import { createQueue, createJobProcessor } from './queue.js';
import type { ChannelJob } from './queue.js';
import { ChannelWorker } from './channel-worker.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log('[Worker] Starting...');
console.log(`[Worker] Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
console.log(`[Worker] Redis: ${REDIS_URL}`);

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ 要求
});

const pool = new WorkerPool(
  { maxConcurrent: 100, healthCheckIntervalMs: 60_000 },
  (workerConfig) => ({
    // deps factory — 實際 deps 依 channel-worker 介面而定
    redis,
    databaseUrl: DATABASE_URL,
  } as any),
);

pool.startHealthCheck();

// ── BullMQ Job Processor ─────────────────────────────────────────
const processor = createJobProcessor(
  redis,
  async (job: ChannelJob) => {
    console.log(`[Worker] Start job: ${job.channelId} (${job.platform})`);
    // pool.spawn 實際啟動 channel worker
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
  },
  async (job: ChannelJob) => {
    console.log(`[Worker] Stop job: ${job.channelId}`);
    await pool.kill(job.channelId, 'job:stop');
  },
);

// ── Graceful Shutdown ─────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  pool.stopHealthCheck();
  await pool.killAll('shutdown');
  await processor.close();
  await redis.quit();
  console.log('[Worker] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[Worker] Ready. Waiting for jobs...');
