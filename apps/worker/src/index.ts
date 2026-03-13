// ── chat-mood-meter Worker 入口 ──────────────────────────────────
// 整合 WorkerPool + TriggerService + BullMQ Queue
// 可獨立跑，也可被 apps/api 引用

export { WorkerPool } from './pool.js';
export type { PoolConfig } from './pool.js';

export { ChannelWorker } from './channel-worker.js';
export type { WorkerConfig, WorkerDeps } from './channel-worker.js';

export { TriggerService } from './trigger.js';
export type { TriggerConfig, StreamEvent, YoutubeChannel } from './trigger.js';

export { createQueue, createJobProcessor, QUEUE_NAME } from './queue.js';
export type { ChannelJob } from './queue.js';
