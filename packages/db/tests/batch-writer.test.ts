/**
 * batch-writer.test.ts
 * BatchWriter 單元測試：使用 mock DB，驗證 buffer 累積、flush、destroy 行為。
 * 完全不需要真實 PostgreSQL 連線，快速且穩定。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchWriter } from '../src/batch-writer.js';
import type { BatchWriterDB } from '../src/batch-writer.js';
import type { EmotionSnapshot, HighlightMarker } from '@cmm/core/types';

// ─── Mock DB ─────────────────────────────────────────────────

/** 建立一個可追蹤呼叫記錄的 mock DB */
function createMockDB(): BatchWriterDB & {
  snapshotCalls: Array<Parameters<BatchWriterDB['batchInsertSnapshots']>[0]>;
  highlightCalls: Array<Parameters<BatchWriterDB['batchInsertHighlights']>[0]>;
  shouldFail: boolean;
} {
  const snapshotCalls: Array<Parameters<BatchWriterDB['batchInsertSnapshots']>[0]> = [];
  const highlightCalls: Array<Parameters<BatchWriterDB['batchInsertHighlights']>[0]> = [];

  return {
    snapshotCalls,
    highlightCalls,
    shouldFail: false,

    async batchInsertSnapshots(items) {
      if (this.shouldFail) throw new Error('mock DB error');
      snapshotCalls.push([...items]);
    },

    async batchInsertHighlights(items) {
      if (this.shouldFail) throw new Error('mock DB error');
      highlightCalls.push([...items]);
    },
  };
}

// ─── 工具函式 ────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<EmotionSnapshot>): EmotionSnapshot {
  return {
    timestamp: Date.now(),
    dominant: 'hype',
    scores: { hype: 0.7, funny: 0.1, sad: 0.05, angry: 0.05 },
    intensity: 0.7,
    messageCount: 10,
    ...overrides,
  };
}

function makeHighlight(overrides?: Partial<HighlightMarker>): HighlightMarker {
  return {
    timestamp: Date.now(),
    emotion: 'hype',
    intensity: 0.85,
    duration: 30_000,
    sampleMessages: ['msg1', 'msg2'],
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('BatchWriter', () => {
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    // 使用 fake timers 控制 setInterval
    vi.useFakeTimers();
    mockDB = createMockDB();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── buffer 累積 ────────────────────────────────────────────

  describe('buffer 累積', () => {
    it('addSnapshot 增加 snapshotBufferSize', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-1', makeSnapshot());
      writer.addSnapshot('session-1', makeSnapshot());

      expect(writer.snapshotBufferSize).toBe(2);

      await writer.destroy();
    });

    it('addHighlight 增加 highlightBufferSize', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addHighlight('session-1', makeHighlight());

      expect(writer.highlightBufferSize).toBe(1);

      await writer.destroy();
    });

    it('多個 sessionId 都能放入同一 buffer', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-A', makeSnapshot({ dominant: 'hype' }));
      writer.addSnapshot('session-B', makeSnapshot({ dominant: 'funny' }));
      writer.addHighlight('session-A', makeHighlight());

      expect(writer.snapshotBufferSize).toBe(2);
      expect(writer.highlightBufferSize).toBe(1);

      await writer.destroy();
    });
  });

  // ── flush() ────────────────────────────────────────────────

  describe('flush()', () => {
    it('清空 buffer 並呼叫 batchInsertSnapshots', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-1', makeSnapshot());
      writer.addSnapshot('session-1', makeSnapshot());

      await writer.flush();

      // buffer 已清空
      expect(writer.snapshotBufferSize).toBe(0);
      // DB 被呼叫一次
      expect(mockDB.snapshotCalls.length).toBe(1);
      // 傳入 2 筆
      expect(mockDB.snapshotCalls[0].length).toBe(2);

      await writer.destroy();
    });

    it('清空 buffer 並呼叫 batchInsertHighlights', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addHighlight('session-1', makeHighlight());
      writer.addHighlight('session-1', makeHighlight());
      writer.addHighlight('session-1', makeHighlight());

      await writer.flush();

      expect(writer.highlightBufferSize).toBe(0);
      expect(mockDB.highlightCalls.length).toBe(1);
      expect(mockDB.highlightCalls[0].length).toBe(3);

      await writer.destroy();
    });

    it('空 buffer flush 不報錯，不呼叫 DB', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      // 空 buffer，直接 flush
      await expect(writer.flush()).resolves.not.toThrow();

      // DB 不應被呼叫
      expect(mockDB.snapshotCalls.length).toBe(0);
      expect(mockDB.highlightCalls.length).toBe(0);

      await writer.destroy();
    });

    it('flush 後再 addSnapshot 能再次累積', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-1', makeSnapshot());
      await writer.flush();

      // flush 後新增
      writer.addSnapshot('session-1', makeSnapshot());
      expect(writer.snapshotBufferSize).toBe(1);

      await writer.flush();
      expect(mockDB.snapshotCalls.length).toBe(2);

      await writer.destroy();
    });

    it('snapshot 與 highlight 同時 flush', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-1', makeSnapshot());
      writer.addHighlight('session-1', makeHighlight());

      await writer.flush();

      expect(mockDB.snapshotCalls.length).toBe(1);
      expect(mockDB.highlightCalls.length).toBe(1);

      await writer.destroy();
    });

    it('只有 snapshots 時不呼叫 batchInsertHighlights', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addSnapshot('session-1', makeSnapshot());
      await writer.flush();

      expect(mockDB.snapshotCalls.length).toBe(1);
      expect(mockDB.highlightCalls.length).toBe(0); // 未呼叫

      await writer.destroy();
    });

    it('只有 highlights 時不呼叫 batchInsertSnapshots', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      writer.addHighlight('session-1', makeHighlight());
      await writer.flush();

      expect(mockDB.snapshotCalls.length).toBe(0); // 未呼叫
      expect(mockDB.highlightCalls.length).toBe(1);

      await writer.destroy();
    });
  });

  // ── 自動 flush（定時器） ───────────────────────────────────

  describe('定時自動 flush', () => {
    it('flushIntervalMs 後自動 flush', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 1000 });

      writer.addSnapshot('session-1', makeSnapshot());
      expect(mockDB.snapshotCalls.length).toBe(0);

      // 觸發計時器
      await vi.advanceTimersByTimeAsync(1000);
      // 因為計時器觸發是 setInterval，等待 microtask 完成
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();

      expect(mockDB.snapshotCalls.length).toBe(1);

      await writer.destroy();
    });

    it('多次自動 flush 累積多批', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 1000 });

      // 第一批
      writer.addSnapshot('session-1', makeSnapshot());
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();

      // 第二批
      writer.addSnapshot('session-1', makeSnapshot());
      writer.addSnapshot('session-1', makeSnapshot());
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();

      expect(mockDB.snapshotCalls.length).toBe(2);
      expect(mockDB.snapshotCalls[0].length).toBe(1);
      expect(mockDB.snapshotCalls[1].length).toBe(2);

      await writer.destroy();
    });
  });

  // ── destroy() ─────────────────────────────────────────────

  describe('destroy()', () => {
    it('停止自動 flush 後不再觸發', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 1000 });

      writer.addSnapshot('session-1', makeSnapshot());
      await writer.destroy(); // 停止 timer 並 flush

      const callCountAfterDestroy = mockDB.snapshotCalls.length;

      // destroy 之後，即使計時器觸發也不應再呼叫 DB
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();

      expect(mockDB.snapshotCalls.length).toBe(callCountAfterDestroy);
    });

    it('destroy 時自動 flush 殘留 snapshots', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 60_000 });

      writer.addSnapshot('session-1', makeSnapshot());
      writer.addSnapshot('session-1', makeSnapshot());

      // 不手動 flush，直接 destroy
      await writer.destroy();

      expect(mockDB.snapshotCalls.length).toBe(1);
      expect(mockDB.snapshotCalls[0].length).toBe(2);
    });

    it('destroy 時自動 flush 殘留 highlights', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 60_000 });

      writer.addHighlight('session-1', makeHighlight());

      await writer.destroy();

      expect(mockDB.highlightCalls.length).toBe(1);
      expect(mockDB.highlightCalls[0].length).toBe(1);
    });

    it('destroy 時 buffer 為空不報錯', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 5000 });

      // 空 buffer destroy
      await expect(writer.destroy()).resolves.not.toThrow();

      expect(mockDB.snapshotCalls.length).toBe(0);
      expect(mockDB.highlightCalls.length).toBe(0);
    });

    it('destroy 後 buffer 清空', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 60_000 });

      writer.addSnapshot('session-1', makeSnapshot());
      writer.addHighlight('session-1', makeHighlight());

      await writer.destroy();

      expect(writer.snapshotBufferSize).toBe(0);
      expect(writer.highlightBufferSize).toBe(0);
    });
  });

  // ── 並發安全 ───────────────────────────────────────────────

  describe('並發 flush', () => {
    it('同時觸發多次 flush 不應重複送出資料', async () => {
      const writer = new BatchWriter(mockDB, { flushIntervalMs: 60_000 });

      writer.addSnapshot('session-1', makeSnapshot({ dominant: 'hype' }));
      writer.addSnapshot('session-1', makeSnapshot({ dominant: 'funny' }));

      // 同時觸發兩次 flush（模擬 timer 與手動呼叫重疊）
      await Promise.all([writer.flush(), writer.flush()]);

      // 因為 splice(0) 是原子操作，第一次 flush 取走所有 2 筆
      // 第二次 flush 面對空 buffer，不呼叫 DB
      const totalItemsInserted = mockDB.snapshotCalls.reduce(
        (sum, batch) => sum + batch.length,
        0,
      );
      expect(totalItemsInserted).toBe(2); // 總共 2 筆，不重複

      await writer.destroy();
    });
  });

  // ── 預設值 ─────────────────────────────────────────────────

  describe('預設 flushIntervalMs', () => {
    it('未傳入 options 時使用 5000ms', async () => {
      // 建立沒有 options 的 BatchWriter
      const writer = new BatchWriter(mockDB);

      writer.addSnapshot('session-1', makeSnapshot());

      // 4999ms 不應 flush
      await vi.advanceTimersByTimeAsync(4999);
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();
      expect(mockDB.snapshotCalls.length).toBe(0);

      // 5000ms 觸發 flush
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve();
      expect(mockDB.snapshotCalls.length).toBe(1);

      await writer.destroy();
    });
  });
});
