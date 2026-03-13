/**
 * queue.test.ts
 *
 * 需要真的 Redis（localhost:6379）。
 * 若 Redis 不可用，測試會自動跳過。
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { createQueue, createJobProcessor, QUEUE_NAME } from '../src/queue.js';
import type { ChannelJob } from '../src/queue.js';

// ── Redis 連線 ──────────────────────────────────────────────────

let redis: IORedis;

beforeAll(async () => {
  redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  // 等待連線
  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
    setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
  });
});

afterAll(async () => {
  // 清空 queue（移除所有 waiting / delayed / active / completed / failed jobs）
  const cleanupQueue = new Queue(QUEUE_NAME, { connection: redis });
  await cleanupQueue.obliterate({ force: true });
  await cleanupQueue.close();
  await redis.quit();
});

// ── 輔助函式 ─────────────────────────────────────────────────────

function makeJob(action: 'start' | 'stop', channelId = 'ch-test'): ChannelJob {
  return {
    action,
    channelId,
    platform: 'twitch',
    channelName: 'test_channel',
    userId: 'user-uuid',
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('createQueue()', () => {
  it('建立 Queue 實例成功', () => {
    const queue = createQueue(redis);
    expect(queue).toBeDefined();
    expect(queue.name).toBe(QUEUE_NAME);
    void queue.close();
  });

  it('加入 job 後 getJobCounts 正確', async () => {
    const queue = createQueue(redis);
    await queue.add('channel-job', makeJob('start', 'ch-count-test'));
    const counts = await queue.getJobCounts();
    expect(counts.waiting + counts.active + counts.delayed).toBeGreaterThanOrEqual(1);
    // 清理
    await queue.drain();
    await queue.close();
  });
});

describe('createJobProcessor()', () => {
  it('start job 被 onStart 正確處理', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn().mockResolvedValue(undefined);

    const queue = createQueue(redis);
    const worker = createJobProcessor(redis, onStart, onStop);

    // 確保 worker 就緒
    await new Promise<void>(resolve => {
      worker.on('ready', resolve);
      setTimeout(resolve, 500); // fallback
    });

    await queue.add('channel-job', makeJob('start', 'ch-start-test'));

    // 等待 job 被處理
    await new Promise<void>((resolve) => {
      worker.on('completed', () => resolve());
      setTimeout(resolve, 5000);
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'start', channelId: 'ch-start-test' }),
    );
    expect(onStop).not.toHaveBeenCalled();

    await worker.close();
    await queue.close();
  });

  it('stop job 被 onStop 正確處理', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn().mockResolvedValue(undefined);

    const queue = createQueue(redis);
    const worker = createJobProcessor(redis, onStart, onStop);

    await new Promise<void>(resolve => {
      worker.on('ready', resolve);
      setTimeout(resolve, 500);
    });

    await queue.add('channel-job', makeJob('stop', 'ch-stop-test'));

    await new Promise<void>((resolve) => {
      worker.on('completed', () => resolve());
      setTimeout(resolve, 5000);
    });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', channelId: 'ch-stop-test' }),
    );
    expect(onStart).not.toHaveBeenCalled();

    await worker.close();
    await queue.close();
  });

  it('依序處理 start 和 stop jobs', async () => {
    const processed: string[] = [];
    const onStart = vi.fn().mockImplementation(async (job: ChannelJob) => {
      processed.push(`start:${job.channelId}`);
    });
    const onStop = vi.fn().mockImplementation(async (job: ChannelJob) => {
      processed.push(`stop:${job.channelId}`);
    });

    const queue = createQueue(redis);
    const worker = createJobProcessor(redis, onStart, onStop);

    await new Promise<void>(resolve => {
      worker.on('ready', resolve);
      setTimeout(resolve, 500);
    });

    // 批量加入
    await queue.addBulk([
      { name: 'job', data: makeJob('start', 'ch-seq-1') },
      { name: 'job', data: makeJob('stop', 'ch-seq-2') },
      { name: 'job', data: makeJob('start', 'ch-seq-3') },
    ]);

    // 等待所有 job 完成
    await new Promise<void>((resolve) => {
      let count = 0;
      worker.on('completed', () => {
        count++;
        if (count >= 3) resolve();
      });
      setTimeout(resolve, 8000);
    });

    expect(processed).toHaveLength(3);
    expect(processed).toEqual(
      expect.arrayContaining(['start:ch-seq-1', 'stop:ch-seq-2', 'start:ch-seq-3']),
    );

    await worker.close();
    await queue.close();
  });
});
