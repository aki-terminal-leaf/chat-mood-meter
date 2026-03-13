import { ChannelWorker, type WorkerConfig, type WorkerDeps } from './channel-worker.js';

export interface PoolConfig {
  maxConcurrent: number;        // 預設 100
  healthCheckIntervalMs: number; // 預設 60000
}

export class WorkerPool {
  private workers: Map<string, ChannelWorker> = new Map(); // channelId → worker
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(
    private config: PoolConfig,
    private depsFactory: (config: WorkerConfig) => WorkerDeps,
  ) {}

  get size(): number {
    return this.workers.size;
  }

  get isFull(): boolean {
    return this.workers.size >= this.config.maxConcurrent;
  }

  async spawn(config: WorkerConfig): Promise<ChannelWorker> {
    if (this.isFull) {
      throw new Error('Worker pool full');
    }
    if (this.workers.has(config.channelId)) {
      throw new Error(`Worker already exists for channel ${config.channelId}`);
    }

    const deps = this.depsFactory(config);
    const worker = new ChannelWorker(config, deps);
    this.workers.set(config.channelId, worker);

    worker.on('stopped', () => {
      this.workers.delete(config.channelId);
    });

    await worker.start();
    return worker;
  }

  async kill(channelId: string, reason: string): Promise<void> {
    const worker = this.workers.get(channelId);
    if (worker) {
      await worker.stop(reason);
      this.workers.delete(channelId);
    }
  }

  async killAll(reason: string): Promise<void> {
    const promises = Array.from(this.workers.values()).map(w => w.stop(reason));
    await Promise.allSettled(promises);
    this.workers.clear();
  }

  getWorker(channelId: string): ChannelWorker | undefined {
    return this.workers.get(channelId);
  }

  getAllStats() {
    return Array.from(this.workers.values()).map(w => w.getStats());
  }

  startHealthCheck(): void {
    this.healthTimer = setInterval(() => {
      for (const [id, worker] of this.workers) {
        if (worker.status === 'error') {
          console.warn(`[Pool] Worker ${id} in error state, killing`);
          void this.kill(id, 'health check: error state');
        }
      }
    }, this.config.healthCheckIntervalMs);
  }

  stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
