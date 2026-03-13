import { Queue, Worker as BullWorker } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAME = 'channel-workers';

export interface ChannelJob {
  action: 'start' | 'stop';
  channelId: string;
  platform: 'twitch' | 'youtube';
  channelName: string;
  userId: string;
  liveChatId?: string;
}

export function createQueue(redis: Redis) {
  return new Queue<ChannelJob>(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: 100, // 保留最近 100 筆已完成 job
      removeOnFail: 200,     // 保留最近 200 筆失敗 job
    },
  });
}

export function createJobProcessor(
  redis: Redis,
  onStart: (job: ChannelJob) => Promise<void>,
  onStop: (job: ChannelJob) => Promise<void>,
) {
  return new BullWorker<ChannelJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.action === 'start') {
        await onStart(job.data);
      } else {
        await onStop(job.data);
      }
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );
}
