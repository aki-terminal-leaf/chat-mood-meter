/**
 * channel-worker.test.ts
 *
 * ChannelWorker 單元測試
 *
 * 策略：
 * - 用 FakeCollector（EventEmitter）取代真實 TwitchCollector，不連線 Twitch
 * - 用 vi.fn() mock 所有 WorkerDeps
 * - 用 vi.useFakeTimers() 控制 RulesAnalyzer 的快照計時器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WorkerConfig, WorkerDeps } from '../src/channel-worker.js';

// ─────────────────────────────────────────────
// FakeCollector
// ─────────────────────────────────────────────

/**
 * 用於測試的假 TwitchCollector
 * 不建立任何網路連線，可手動 emit 'message' 事件
 */
class FakeCollector extends EventEmitter {
  public startCalled = false;
  public stopCalled = false;

  async start(): Promise<void> {
    this.startCalled = true;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
  }
}

// 測試間共用的 collector 實例（在 mock 工廠中被賦值）
let fakeCollector: FakeCollector;

// ─────────────────────────────────────────────
// Mock @cmm/collector/twitch
// ─────────────────────────────────────────────

vi.mock('@cmm/collector/twitch', async () => {
  // 在 mock 工廠內定義，捕捉最新建立的實例
  class MockTwitchCollector extends EventEmitter {
    public startCalled = false;
    public stopCalled = false;

    constructor(_opts: unknown) {
      super();
      // 將此實例暴露給測試（透過模組外部變數）
      fakeCollector = this as unknown as FakeCollector;
    }

    async start(): Promise<void> {
      this.startCalled = true;
    }

    async stop(): Promise<void> {
      this.stopCalled = true;
    }
  }

  return { TwitchCollector: MockTwitchCollector };
});

// mock 宣告必須在 import 之前（vi.mock 會被 vitest 提升），
// 但實際的 import 寫在 mock 之後才會正確套用。
import { ChannelWorker } from '../src/channel-worker.js';

// ─────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────

/** 建立一組乾淨的 mock deps */
function makeDeps(): WorkerDeps {
  return {
    onSnapshot:    vi.fn(),
    onHighlight:   vi.fn(),
    saveSnapshot:  vi.fn(),
    saveHighlight: vi.fn(),
    createSession: vi.fn().mockResolvedValue('session-uuid-001'),
    endSession:    vi.fn().mockResolvedValue(undefined),
  };
}

/** 基本 WorkerConfig */
const BASE_CONFIG: WorkerConfig = {
  jobId:       'job-001',
  userId:      'user-001',
  channelId:   'channel-uuid-001',
  platform:    'twitch',
  channelName: 'testchannel',
};

// ─────────────────────────────────────────────
// 測試套件
// ─────────────────────────────────────────────

describe('ChannelWorker', () => {
  let worker: ChannelWorker;
  let deps: WorkerDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = makeDeps();
    worker = new ChannelWorker(BASE_CONFIG, deps);
  });

  afterEach(async () => {
    // 確保每個測試後 worker 都乾淨停止
    if (worker.status === 'running' || worker.status === 'starting') {
      await worker.stop('test cleanup');
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 測試 1：start() → status 變 running ──────────────────

  it('start() 後 status 應為 running，並 emit started 事件', async () => {
    const startedPayloads: unknown[] = [];
    worker.on('started', (payload) => startedPayloads.push(payload));

    await worker.start();

    expect(worker.status).toBe('running');
    expect(startedPayloads).toHaveLength(1);
    expect(startedPayloads[0]).toEqual({ sessionId: 'session-uuid-001' });
    expect(deps.createSession).toHaveBeenCalledOnce();
    expect(deps.createSession).toHaveBeenCalledWith('channel-uuid-001');
  });

  // ── 測試 2：訊息流 → snapshot → saveSnapshot 被呼叫 ──────

  it('collector emit message → analyzer 產生 snapshot → deps.saveSnapshot 被呼叫', async () => {
    await worker.start();

    // 確認 fakeCollector 已被建立
    expect(fakeCollector).toBeDefined();

    // 模擬收到 3 則聊天訊息
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      fakeCollector.emit('message', {
        platform:  'twitch',
        user:      `user${i}`,
        text:      'PogChamp KEKW',
        emotes:    ['PogChamp'],
        timestamp: now + i * 100,
        raw:       null,
      });
    }

    // 推進假計時器 1.1 秒，觸發 RulesAnalyzer 的快照間隔（snapshotIntervalMs: 1000）
    await vi.advanceTimersByTimeAsync(1100);

    // saveSnapshot 應該至少被呼叫一次
    expect(deps.saveSnapshot).toHaveBeenCalled();

    // 每次 saveSnapshot 的第一個參數應為 session ID
    const calls = vi.mocked(deps.saveSnapshot).mock.calls;
    expect(calls[0][0]).toBe('session-uuid-001');

    // snapshot 物件應含必要欄位
    const snapshot = calls[0][1];
    expect(snapshot).toHaveProperty('timestamp');
    expect(snapshot).toHaveProperty('dominant');
    expect(snapshot).toHaveProperty('intensity');
    expect(snapshot).toHaveProperty('messageCount');

    // onSnapshot 同樣應該被呼叫，且傳入正確的 channelId
    expect(deps.onSnapshot).toHaveBeenCalled();
    expect(vi.mocked(deps.onSnapshot).mock.calls[0][0]).toBe('channel-uuid-001');
  });

  // ── 測試 3：stop() → status 變 idle → endSession 被呼叫 ──

  it('stop() 後 status 應為 idle，deps.endSession 被呼叫並帶正確 stats', async () => {
    await worker.start();

    // 模擬 2 則訊息
    const now = Date.now();
    fakeCollector.emit('message', {
      platform: 'twitch', user: 'a', text: 'hello', emotes: [], timestamp: now,
    });
    fakeCollector.emit('message', {
      platform: 'twitch', user: 'b', text: 'world', emotes: [], timestamp: now + 50,
    });

    // 推進計時器產生快照，更新 peakIntensity
    await vi.advanceTimersByTimeAsync(1100);

    const stoppedPayloads: unknown[] = [];
    worker.on('stopped', (payload) => stoppedPayloads.push(payload));

    await worker.stop('manual stop');

    expect(worker.status).toBe('idle');
    expect(deps.endSession).toHaveBeenCalledOnce();

    const [sessionId, stats] = vi.mocked(deps.endSession).mock.calls[0];
    expect(sessionId).toBe('session-uuid-001');
    expect(stats.totalMessages).toBe(2);
    expect(stats.totalHighlights).toBeGreaterThanOrEqual(0);
    expect(typeof stats.peakIntensity).toBe('number');

    // stopped 事件應被 emit
    expect(stoppedPayloads).toHaveLength(1);
    expect(stoppedPayloads[0]).toMatchObject({
      reason:    'manual stop',
      sessionId: 'session-uuid-001',
    });
  });

  // ── 測試 4：getStats() 回傳正確數值 ───────────────────────

  it('getStats() 應回傳正確的統計資料', async () => {
    await worker.start();

    // 初始狀態
    let stats = worker.getStats();
    expect(stats.jobId).toBe('job-001');
    expect(stats.channelName).toBe('testchannel');
    expect(stats.platform).toBe('twitch');
    expect(stats.status).toBe('running');
    expect(stats.sessionId).toBe('session-uuid-001');
    expect(stats.messageCount).toBe(0);
    expect(stats.highlightCount).toBe(0);
    expect(stats.peakIntensity).toBe(0);
    expect(stats.uptime).toBeGreaterThanOrEqual(0);

    // 送入 5 則訊息
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      fakeCollector.emit('message', {
        platform: 'twitch', user: `u${i}`, text: 'LUL', emotes: [], timestamp: now + i * 100,
      });
    }

    stats = worker.getStats();
    expect(stats.messageCount).toBe(5);

    // uptime 應為正數
    await vi.advanceTimersByTimeAsync(500);
    stats = worker.getStats();
    expect(stats.uptime).toBeGreaterThan(0);
  });

  // ── 測試 5：重複 stop() 不報錯 ───────────────────────────

  it('重複呼叫 stop() 不應拋出例外，且 endSession 只呼叫一次', async () => {
    await worker.start();

    // 第一次 stop
    await worker.stop('first stop');
    expect(worker.status).toBe('idle');
    expect(deps.endSession).toHaveBeenCalledOnce();

    // 第二次 stop — 應為冪等，不報錯
    await expect(worker.stop('second stop')).resolves.toBeUndefined();
    expect(worker.status).toBe('idle');

    // endSession 不應再被呼叫
    expect(deps.endSession).toHaveBeenCalledOnce();
  });

  // ── 測試 6：初始 status 為 idle ──────────────────────────

  it('建立後初始 status 應為 idle，getStats 的 uptime 應為 0', () => {
    const freshWorker = new ChannelWorker(BASE_CONFIG, deps);
    expect(freshWorker.status).toBe('idle');

    const stats = freshWorker.getStats();
    expect(stats.status).toBe('idle');
    expect(stats.sessionId).toBeNull();
    expect(stats.uptime).toBe(0);
  });
});
