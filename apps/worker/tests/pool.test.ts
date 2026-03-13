import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WorkerPool } from '../src/pool.js';
import type { PoolConfig } from '../src/pool.js';
import type { WorkerConfig, WorkerDeps } from '../src/channel-worker.js';

// ── vi.mock：必須先於 import，factory 不能參照外部變數 ──────────
// vi.mock 會被 vitest hoisted 到最頂，所以 MockChannelWorker 的定義
// 必須放在 factory 函式「內部」（避免 TDZ 錯誤）。

vi.mock('../src/channel-worker.js', () => {
  const { EventEmitter } = require('node:events');

  class MockChannelWorker extends EventEmitter {
    public status: 'idle' | 'running' | 'stopped' | 'error' = 'idle';
    private _config: { channelId: string };

    constructor(config: { channelId: string }, _deps: unknown) {
      super();
      this._config = config;
    }

    async start(): Promise<void> {
      this.status = 'running';
    }

    async stop(_reason: string): Promise<void> {
      this.status = 'stopped';
      this.emit('stopped');
    }

    getStats() {
      return {
        channelId: this._config.channelId,
        status: this.status,
        messagesProcessed: 0,
        startedAt: Date.now(),
      };
    }

    simulateError(): void {
      this.status = 'error';
    }
  }

  return { ChannelWorker: MockChannelWorker };
});

// ── 取得 mock class（透過 import 取 hoisted 版本）────────────────
// pool.ts 裡用的就是上面 mock 回傳的 ChannelWorker
import { ChannelWorker } from '../src/channel-worker.js';
type MockWorker = InstanceType<typeof ChannelWorker> & { simulateError(): void };

// ── 輔助函式 ─────────────────────────────────────────────────────

function makeDepsFactory(): (config: WorkerConfig) => WorkerDeps {
  return (_config) => ({} as WorkerDeps);
}

function makePoolConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    maxConcurrent: 3,
    healthCheckIntervalMs: 50, // 測試用短一點
    ...overrides,
  };
}

function makeWorkerConfig(channelId: string, overrides?: Partial<WorkerConfig>): WorkerConfig {
  return {
    channelId,
    jobId: `job-${channelId}`,
    platform: 'twitch',
    channelName: `channel_${channelId}`,
    userId: `user_${channelId}`,
    ...overrides,
  } as WorkerConfig;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool(makePoolConfig(), makeDepsFactory());
  });

  afterEach(async () => {
    await pool.killAll('test cleanup');
    pool.stopHealthCheck();
  });

  // ── spawn ─────────────────────────────────────────────────────

  describe('spawn()', () => {
    it('成功 spawn 一個 worker', async () => {
      const worker = await pool.spawn(makeWorkerConfig('ch-001'));
      expect(worker).toBeDefined();
      expect(pool.size).toBe(1);
    });

    it('spawn 後 worker 狀態為 running', async () => {
      const worker = await pool.spawn(makeWorkerConfig('ch-002')) as unknown as MockWorker;
      expect((worker as { status: string }).status).toBe('running');
    });

    it('spawn 成功後 pool.size 正確增加', async () => {
      await pool.spawn(makeWorkerConfig('ch-003'));
      await pool.spawn(makeWorkerConfig('ch-004'));
      expect(pool.size).toBe(2);
    });

    it('重複 spawn 同一 channelId 應拋出錯誤', async () => {
      await pool.spawn(makeWorkerConfig('ch-dup'));
      await expect(pool.spawn(makeWorkerConfig('ch-dup'))).rejects.toThrow(
        'Worker already exists for channel ch-dup',
      );
    });

    it('worker 停止後會自動從 pool 中移除', async () => {
      const worker = await pool.spawn(makeWorkerConfig('ch-auto-remove'));
      expect(pool.size).toBe(1);
      await worker.stop('test');
      // 'stopped' event 觸發後 pool 應自動移除
      expect(pool.size).toBe(0);
    });
  });

  // ── isFull ────────────────────────────────────────────────────

  describe('isFull', () => {
    it('未滿時 isFull = false', async () => {
      await pool.spawn(makeWorkerConfig('ch-full-1'));
      expect(pool.isFull).toBe(false);
    });

    it('達到 maxConcurrent 時 isFull = true', async () => {
      await pool.spawn(makeWorkerConfig('ch-f1'));
      await pool.spawn(makeWorkerConfig('ch-f2'));
      await pool.spawn(makeWorkerConfig('ch-f3')); // maxConcurrent = 3
      expect(pool.isFull).toBe(true);
    });

    it('pool 已滿時 spawn 應拋出 "Worker pool full"', async () => {
      await pool.spawn(makeWorkerConfig('ch-limit-1'));
      await pool.spawn(makeWorkerConfig('ch-limit-2'));
      await pool.spawn(makeWorkerConfig('ch-limit-3'));
      await expect(pool.spawn(makeWorkerConfig('ch-limit-4'))).rejects.toThrow(
        'Worker pool full',
      );
    });
  });

  // ── kill ──────────────────────────────────────────────────────

  describe('kill()', () => {
    it('kill 存在的 worker 後 pool.size 減少', async () => {
      await pool.spawn(makeWorkerConfig('ch-kill-1'));
      await pool.spawn(makeWorkerConfig('ch-kill-2'));
      await pool.kill('ch-kill-1', 'test kill');
      expect(pool.size).toBe(1);
    });

    it('kill 不存在的 channelId 不拋出錯誤', async () => {
      await expect(pool.kill('non-existent', 'test')).resolves.not.toThrow();
    });

    it('kill 後 getWorker 應回傳 undefined', async () => {
      await pool.spawn(makeWorkerConfig('ch-kill-get'));
      await pool.kill('ch-kill-get', 'test');
      expect(pool.getWorker('ch-kill-get')).toBeUndefined();
    });
  });

  // ── killAll ───────────────────────────────────────────────────

  describe('killAll()', () => {
    it('killAll 後 pool.size = 0', async () => {
      await pool.spawn(makeWorkerConfig('ch-ka-1'));
      await pool.spawn(makeWorkerConfig('ch-ka-2'));
      await pool.killAll('shutdown');
      expect(pool.size).toBe(0);
    });

    it('killAll 對空 pool 不拋出錯誤', async () => {
      await expect(pool.killAll('empty')).resolves.not.toThrow();
    });
  });

  // ── getAllStats ───────────────────────────────────────────────

  describe('getAllStats()', () => {
    it('空 pool 回傳空陣列', () => {
      expect(pool.getAllStats()).toEqual([]);
    });

    it('回傳所有 worker 的 stats', async () => {
      await pool.spawn(makeWorkerConfig('ch-stats-1'));
      await pool.spawn(makeWorkerConfig('ch-stats-2'));
      const stats = pool.getAllStats();
      expect(stats).toHaveLength(2);
      expect(stats.map(s => s.channelId)).toEqual(
        expect.arrayContaining(['ch-stats-1', 'ch-stats-2']),
      );
    });
  });

  // ── healthCheck ───────────────────────────────────────────────

  describe('healthCheck', () => {
    it('健康檢查會清除 error 狀態的 worker', async () => {
      const worker = await pool.spawn(makeWorkerConfig('ch-err')) as unknown as MockWorker;
      expect(pool.size).toBe(1);

      // 模擬 worker 進入 error 狀態
      worker.simulateError();
      expect((worker as { status: string }).status).toBe('error');

      pool.startHealthCheck();

      // 等待健康檢查觸發（interval = 50ms）
      await new Promise(resolve => setTimeout(resolve, 200));

      pool.stopHealthCheck();

      expect(pool.size).toBe(0);
    });

    it('stopHealthCheck 後不再清理 error worker', async () => {
      const worker = await pool.spawn(makeWorkerConfig('ch-no-clean')) as unknown as MockWorker;

      pool.startHealthCheck();
      pool.stopHealthCheck(); // 立刻停止

      worker.simulateError();

      // 等夠久，但 timer 已停，不應觸發清理
      await new Promise(resolve => setTimeout(resolve, 200));

      // worker 仍在 pool 中
      expect(pool.size).toBe(1);
    });
  });
});
