/**
 * main.test.ts
 *
 * Worker Entry Point 單元測試
 *
 * 策略：
 * - vi.mock() 攔截所有外部依賴（ioredis、pool、queue）
 * - 測試從 main.ts export 的純函式：loadWorkerConfig / createStartHandler / createStopHandler / shutdown
 * - 測試模組初始化時 WorkerPool、createJobProcessor 的呼叫方式
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────
// Mock 外部依賴（vi.mock 會被提升到 import 前）
// ─────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}));

vi.mock('ioredis', () => ({
  // 使用 function（非 arrow function）才能搭配 new 呼叫
  default: vi.fn(function MockIORedis() {
    return { quit: vi.fn().mockResolvedValue('OK') };
  }),
}));

vi.mock('../src/pool.js', () => ({
  WorkerPool: vi.fn(function MockWorkerPool() {
    return {
      startHealthCheck: vi.fn(),
      stopHealthCheck: vi.fn(),
      spawn: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      killAll: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../src/queue.js', () => ({
  QUEUE_NAME: 'channel-workers',
  createQueue: vi.fn(),
  createJobProcessor: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }),
}));

// ─────────────────────────────────────────────
// Import（mock 套用後才 import）
// ─────────────────────────────────────────────

import {
  loadWorkerConfig,
  createStartHandler,
  createStopHandler,
  shutdown,
} from '../src/main.js';
import { WorkerPool } from '../src/pool.js';
import { createJobProcessor, QUEUE_NAME } from '../src/queue.js';

// ─────────────────────────────────────────────
// 輔助函式
// ─────────────────────────────────────────────

function makeMockPool() {
  return {
    startHealthCheck: vi.fn(),
    stopHealthCheck: vi.fn(),
    spawn: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    killAll: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockProcessor() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
}

function makeMockRedis() {
  return {
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

const BASE_JOB = {
  action: 'start' as const,
  channelId: 'channel-uuid-001',
  platform: 'twitch' as const,
  channelName: 'testchannel',
  userId: 'user-001',
};

// ─────────────────────────────────────────────
// 測試套件
// ─────────────────────────────────────────────

describe('loadWorkerConfig()', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  it('未設定環境變數時應回傳開發用預設值', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;

    const config = loadWorkerConfig();

    expect(config.databaseUrl).toBe(
      'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter',
    );
    expect(config.redisUrl).toBe('redis://localhost:6379');
  });

  it('設定 DATABASE_URL 後應覆蓋預設值', () => {
    process.env.DATABASE_URL = 'postgresql://prod-user:secret@prod-db:5432/mydb';
    const config = loadWorkerConfig();
    expect(config.databaseUrl).toBe(
      'postgresql://prod-user:secret@prod-db:5432/mydb',
    );
  });

  it('設定 REDIS_URL 後應覆蓋預設值', () => {
    process.env.REDIS_URL = 'redis://prod-redis:6380';
    const config = loadWorkerConfig();
    expect(config.redisUrl).toBe('redis://prod-redis:6380');
  });

  it('同時設定兩個環境變數時都應生效', () => {
    process.env.DATABASE_URL = 'postgresql://a:b@host:5432/db';
    process.env.REDIS_URL = 'redis://host:6379/1';
    const config = loadWorkerConfig();
    expect(config.databaseUrl).toBe('postgresql://a:b@host:5432/db');
    expect(config.redisUrl).toBe('redis://host:6379/1');
  });
});

// ─────────────────────────────────────────────

describe('createStartHandler()', () => {
  let mockPool: ReturnType<typeof makeMockPool>;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('應回傳一個函式', () => {
    const handler = createStartHandler(mockPool as any);
    expect(typeof handler).toBe('function');
  });

  it('呼叫後應以正確參數呼叫 pool.spawn', async () => {
    const handler = createStartHandler(mockPool as any);
    await handler(BASE_JOB);

    expect(mockPool.spawn).toHaveBeenCalledOnce();
    expect(mockPool.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-uuid-001',
        platform: 'twitch',
        channelName: 'testchannel',
        userId: 'user-001',
      }),
    );
  });

  it('有 liveChatId 時應傳入 pool.spawn', async () => {
    const handler = createStartHandler(mockPool as any);
    const jobWithLiveChat = { ...BASE_JOB, liveChatId: 'live-chat-abc' };
    await handler(jobWithLiveChat);

    expect(mockPool.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ liveChatId: 'live-chat-abc' }),
    );
  });

  it('pool.spawn 拋出例外時，handler 應重新拋出', async () => {
    const spawnError = new Error('spawn failed: pool full');
    mockPool.spawn.mockRejectedValue(spawnError);

    const handler = createStartHandler(mockPool as any);

    await expect(handler(BASE_JOB)).rejects.toThrow('spawn failed: pool full');
  });
});

// ─────────────────────────────────────────────

describe('createStopHandler()', () => {
  let mockPool: ReturnType<typeof makeMockPool>;

  beforeEach(() => {
    mockPool = makeMockPool();
  });

  it('應回傳一個函式', () => {
    const handler = createStopHandler(mockPool as any);
    expect(typeof handler).toBe('function');
  });

  it('呼叫後應以 channelId 和 "job:stop" 呼叫 pool.kill', async () => {
    const handler = createStopHandler(mockPool as any);
    const stopJob = { ...BASE_JOB, action: 'stop' as const };

    await handler(stopJob);

    expect(mockPool.kill).toHaveBeenCalledOnce();
    expect(mockPool.kill).toHaveBeenCalledWith('channel-uuid-001', 'job:stop');
  });

  it('stop reason 固定為 "job:stop"，不受 job 內容影響', async () => {
    const handler = createStopHandler(mockPool as any);
    const stopJob = { ...BASE_JOB, action: 'stop' as const, channelId: 'other-channel' };

    await handler(stopJob);

    const [channelId, reason] = mockPool.kill.mock.calls[0];
    expect(channelId).toBe('other-channel');
    expect(reason).toBe('job:stop');
  });
});

// ─────────────────────────────────────────────

describe('shutdown()', () => {
  let mockPool: ReturnType<typeof makeMockPool>;
  let mockProcessor: ReturnType<typeof makeMockProcessor>;
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPool = makeMockPool();
    mockProcessor = makeMockProcessor();
    mockRedis = makeMockRedis();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('應呼叫 pool.stopHealthCheck()', async () => {
    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);
    expect(mockPool.stopHealthCheck).toHaveBeenCalledOnce();
  });

  it('應以 "shutdown" 為 reason 呼叫 pool.killAll()', async () => {
    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);
    expect(mockPool.killAll).toHaveBeenCalledOnce();
    expect(mockPool.killAll).toHaveBeenCalledWith('shutdown');
  });

  it('應呼叫 processor.close()', async () => {
    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);
    expect(mockProcessor.close).toHaveBeenCalledOnce();
  });

  it('應呼叫 redis.quit()', async () => {
    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);
    expect(mockRedis.quit).toHaveBeenCalledOnce();
  });

  it('最後應呼叫 process.exit(0)', async () => {
    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('SIGINT 信號也應完整執行 shutdown 流程', async () => {
    await shutdown('SIGINT', mockPool as any, mockProcessor, mockRedis as any);

    expect(mockPool.stopHealthCheck).toHaveBeenCalled();
    expect(mockPool.killAll).toHaveBeenCalledWith('shutdown');
    expect(mockProcessor.close).toHaveBeenCalled();
    expect(mockRedis.quit).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('shutdown 各步驟應依序執行（不並行）', async () => {
    const callOrder: string[] = [];
    mockPool.stopHealthCheck.mockImplementation(() => {
      callOrder.push('stopHealthCheck');
    });
    mockPool.killAll.mockImplementation(async () => {
      callOrder.push('killAll');
    });
    mockProcessor.close.mockImplementation(async () => {
      callOrder.push('processorClose');
    });
    mockRedis.quit.mockImplementation(async () => {
      callOrder.push('redisQuit');
      return 'OK';
    });

    await shutdown('SIGTERM', mockPool as any, mockProcessor, mockRedis as any);

    expect(callOrder).toEqual([
      'stopHealthCheck',
      'killAll',
      'processorClose',
      'redisQuit',
    ]);
  });
});

// ─────────────────────────────────────────────

describe('模組初始化', () => {
  it('WorkerPool 應在模組載入時被建立', () => {
    expect(vi.mocked(WorkerPool)).toHaveBeenCalled();
  });

  it('WorkerPool 應以 maxConcurrent: 100 初始化', () => {
    const [poolConfig] = vi.mocked(WorkerPool).mock.calls[0];
    expect(poolConfig).toMatchObject({ maxConcurrent: 100 });
  });

  it('WorkerPool 應以 healthCheckIntervalMs: 60000 初始化', () => {
    const [poolConfig] = vi.mocked(WorkerPool).mock.calls[0];
    expect(poolConfig).toMatchObject({ healthCheckIntervalMs: 60_000 });
  });

  it('createJobProcessor 應在模組載入時被呼叫一次', () => {
    expect(vi.mocked(createJobProcessor)).toHaveBeenCalledOnce();
  });

  it('createJobProcessor 應傳入兩個 handler 函式', () => {
    const [_redis, onStart, onStop] = vi.mocked(createJobProcessor).mock.calls[0];
    expect(typeof onStart).toBe('function');
    expect(typeof onStop).toBe('function');
  });

  it('QUEUE_NAME 應為 "channel-workers"', () => {
    expect(QUEUE_NAME).toBe('channel-workers');
  });
});
