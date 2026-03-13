/**
 * storage-db.test.ts
 * 測試 SessionDB：使用真實 SQLite 臨時檔案，涵蓋所有 CRUD 操作。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionDB } from '../src/storage/db.js';
import type { EmotionSnapshot, HighlightMarker } from '../src/types.js';

// ─── 工具函式 ────────────────────────────────────────────────

/**
 * 建立測試用 EmotionSnapshot
 */
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

/**
 * 建立測試用 HighlightMarker
 */
function makeHighlight(overrides?: Partial<HighlightMarker>): HighlightMarker {
  return {
    timestamp: Date.now(),
    emotion: 'hype',
    intensity: 0.85,
    duration: 30_000,
    sampleMessages: ['[2026-03-13T10:00:00.000Z] dominant=hype intensity=0.85 msgs=15'],
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('SessionDB', () => {
  // 每個測試都使用獨立的臨時目錄和 DB 檔案
  let tmpDir: string;
  let dbPath: string;
  let db: SessionDB;

  beforeEach(() => {
    // 建立臨時目錄
    tmpDir = mkdtempSync(join(tmpdir(), 'cmm-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new SessionDB(dbPath);
  });

  afterEach(() => {
    // 關閉 DB，清理臨時目錄
    try { db.close(); } catch { /* 已關閉則忽略 */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 建構子 ──────────────────────────────────────────────────

  describe('建構子', () => {
    it('應建立 DB 檔案', () => {
      expect(existsSync(dbPath)).toBe(true);
    });

    it('應自動建立 tables（不拋錯）', () => {
      // 若 tables 建立失敗，後續操作都會拋錯
      expect(() => db.getSessionId()).not.toThrow();
    });
  });

  // ── getSessionId() ───────────────────────────────────────────

  describe('getSessionId()', () => {
    it('回傳非空字串', () => {
      const id = db.getSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('格式為 ISO 日期字串', () => {
      const id = db.getSessionId();
      // ISO 8601 格式：YYYY-MM-DDTHH:mm:ss.sssZ
      expect(() => new Date(id)).not.toThrow();
      expect(new Date(id).toISOString()).toBe(id);
    });
  });

  // ── startSession() ───────────────────────────────────────────

  describe('startSession()', () => {
    it('建立新 session 後可列出', () => {
      db.startSession();
      const sessions = db.listSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe(db.getSessionId());
    });

    it('session 初始狀態：totalMessages=0, totalHighlights=0', () => {
      db.startSession();
      const sessions = db.listSessions();
      expect(sessions[0].totalMessages).toBe(0);
      expect(sessions[0].totalHighlights).toBe(0);
    });

    it('session 初始狀態：endedAt 為 null', () => {
      db.startSession();
      const sessions = db.listSessions();
      expect(sessions[0].endedAt).toBeNull();
    });
  });

  // ── saveSnapshot() ───────────────────────────────────────────

  describe('saveSnapshot()', () => {
    it('寫入快照後可查詢', () => {
      db.startSession();
      const snap = makeSnapshot({ timestamp: Date.now() });
      db.saveSnapshot(snap);

      const snapshots = db.getSnapshots(db.getSessionId());
      expect(snapshots.length).toBe(1);
    });

    it('快照欄位正確儲存', () => {
      db.startSession();
      const ts = Date.now();
      const snap = makeSnapshot({
        timestamp: ts,
        dominant: 'funny',
        intensity: 0.6,
        messageCount: 8,
        scores: { hype: 0.2, funny: 0.6, sad: 0.1, angry: 0.1 },
      });
      db.saveSnapshot(snap);

      const [stored] = db.getSnapshots(db.getSessionId());
      expect(stored.timestamp).toBe(ts);
      expect(stored.dominant).toBe('funny');
      expect(stored.intensity).toBeCloseTo(0.6);
      expect(stored.messageCount).toBe(8);
      expect(stored.scores.funny).toBeCloseTo(0.6);
    });

    it('可連續寫入多筆快照', () => {
      db.startSession();
      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        db.saveSnapshot(makeSnapshot({ timestamp: base + i * 1000 }));
      }

      const snapshots = db.getSnapshots(db.getSessionId());
      expect(snapshots.length).toBe(5);
    });
  });

  // ── saveHighlight() ──────────────────────────────────────────

  describe('saveHighlight()', () => {
    it('寫入高光後可查詢', () => {
      db.startSession();
      db.saveHighlight(makeHighlight());

      const highlights = db.getHighlights(db.getSessionId());
      expect(highlights.length).toBe(1);
    });

    it('高光欄位正確儲存（含 sampleMessages 反序列化）', () => {
      db.startSession();
      const ts = Date.now();
      const samples = ['msg1', 'msg2', 'msg3'];
      db.saveHighlight(makeHighlight({
        timestamp: ts,
        emotion: 'angry',
        intensity: 0.9,
        duration: 30_000,
        sampleMessages: samples,
      }));

      const [stored] = db.getHighlights(db.getSessionId());
      expect(stored.timestamp).toBe(ts);
      expect(stored.emotion).toBe('angry');
      expect(stored.intensity).toBeCloseTo(0.9);
      expect(stored.duration).toBe(30_000);
      expect(stored.sampleMessages).toEqual(samples);
    });

    it('saveHighlight 應使 session 的 total_highlights 遞增', () => {
      db.startSession();
      db.saveHighlight(makeHighlight());
      db.saveHighlight(makeHighlight());

      const sessions = db.listSessions();
      expect(sessions[0].totalHighlights).toBe(2);
    });
  });

  // ── endSession() ─────────────────────────────────────────────

  describe('endSession()', () => {
    it('呼叫後 endedAt 不為 null', () => {
      db.startSession();
      db.endSession();

      const sessions = db.listSessions();
      expect(sessions[0].endedAt).not.toBeNull();
      expect(typeof sessions[0].endedAt).toBe('number');
    });

    it('endedAt 大於 startedAt', () => {
      db.startSession();
      db.endSession();

      const sessions = db.listSessions();
      expect(sessions[0].endedAt!).toBeGreaterThan(sessions[0].startedAt);
    });

    it('endSession 後 totalMessages 反映快照的 messageCount 加總', () => {
      db.startSession();
      db.saveSnapshot(makeSnapshot({ messageCount: 10 }));
      db.saveSnapshot(makeSnapshot({ messageCount: 15 }));
      db.saveSnapshot(makeSnapshot({ messageCount: 5 }));
      db.endSession();

      const sessions = db.listSessions();
      expect(sessions[0].totalMessages).toBe(30);
    });
  });

  // ── listSessions() ───────────────────────────────────────────

  describe('listSessions()', () => {
    it('無 session 時回傳空陣列', () => {
      // 注意：新建構子只設定 sessionId，不呼叫 startSession()
      const sessions = db.listSessions();
      expect(sessions).toEqual([]);
    });

    it('回傳陣列包含正確欄位', () => {
      db.startSession();
      const [s] = db.listSessions();
      expect(s).toHaveProperty('sessionId');
      expect(s).toHaveProperty('startedAt');
      expect(s).toHaveProperty('endedAt');
      expect(s).toHaveProperty('totalMessages');
      expect(s).toHaveProperty('totalHighlights');
    });
  });

  // ── getSessionSummary() ──────────────────────────────────────

  describe('getSessionSummary()', () => {
    it('找不到 session 時回傳 null', () => {
      const result = db.getSessionSummary('nonexistent-session-id');
      expect(result).toBeNull();
    });

    it('回傳正確摘要結構', () => {
      db.startSession();
      const sessionId = db.getSessionId();

      db.saveSnapshot(makeSnapshot({ dominant: 'hype', intensity: 0.8, messageCount: 10 }));
      db.saveSnapshot(makeSnapshot({ dominant: 'hype', intensity: 0.6, messageCount: 5 }));
      db.saveHighlight(makeHighlight());
      db.endSession();

      const summary = db.getSessionSummary(sessionId);
      expect(summary).not.toBeNull();

      // 欄位存在性
      expect(summary!).toHaveProperty('sessionId', sessionId);
      expect(summary!).toHaveProperty('startedAt');
      expect(summary!).toHaveProperty('endedAt');
      expect(summary!).toHaveProperty('totalMessages');
      expect(summary!).toHaveProperty('totalHighlights', 1);
      expect(summary!).toHaveProperty('snapshotCount', 2);
      expect(summary!).toHaveProperty('peakIntensity');
      expect(summary!).toHaveProperty('dominantEmotion');
      expect(summary!).toHaveProperty('avgIntensity');
    });

    it('peakIntensity 為最大值', () => {
      db.startSession();
      db.saveSnapshot(makeSnapshot({ intensity: 0.5 }));
      db.saveSnapshot(makeSnapshot({ intensity: 0.9 }));
      db.saveSnapshot(makeSnapshot({ intensity: 0.7 }));
      db.endSession();

      const summary = db.getSessionSummary(db.getSessionId());
      expect(summary!.peakIntensity).toBeCloseTo(0.9);
    });

    it('dominantEmotion 為最常出現的情緒', () => {
      db.startSession();
      db.saveSnapshot(makeSnapshot({ dominant: 'hype' }));
      db.saveSnapshot(makeSnapshot({ dominant: 'hype' }));
      db.saveSnapshot(makeSnapshot({ dominant: 'funny' }));
      db.endSession();

      const summary = db.getSessionSummary(db.getSessionId());
      expect(summary!.dominantEmotion).toBe('hype');
    });
  });

  // ── getSnapshots() ───────────────────────────────────────────

  describe('getSnapshots()', () => {
    it('回傳快照陣列，按時間升序排列', () => {
      db.startSession();
      const base = Date.now();
      db.saveSnapshot(makeSnapshot({ timestamp: base + 2000 }));
      db.saveSnapshot(makeSnapshot({ timestamp: base + 1000 }));
      db.saveSnapshot(makeSnapshot({ timestamp: base }));

      const snapshots = db.getSnapshots(db.getSessionId());
      expect(snapshots.length).toBe(3);
      // 驗證升序
      expect(snapshots[0].timestamp).toBeLessThan(snapshots[1].timestamp);
      expect(snapshots[1].timestamp).toBeLessThan(snapshots[2].timestamp);
    });

    it('session 不存在時回傳空陣列', () => {
      const snapshots = db.getSnapshots('no-such-session');
      expect(snapshots).toEqual([]);
    });
  });

  // ── getHighlights() ──────────────────────────────────────────

  describe('getHighlights()', () => {
    it('回傳高光陣列，按時間升序排列', () => {
      db.startSession();
      const base = Date.now();
      db.saveHighlight(makeHighlight({ timestamp: base + 2000 }));
      db.saveHighlight(makeHighlight({ timestamp: base + 1000 }));
      db.saveHighlight(makeHighlight({ timestamp: base }));

      const highlights = db.getHighlights(db.getSessionId());
      expect(highlights.length).toBe(3);
      expect(highlights[0].timestamp).toBeLessThan(highlights[1].timestamp);
    });

    it('session 不存在時回傳空陣列', () => {
      const highlights = db.getHighlights('no-such-session');
      expect(highlights).toEqual([]);
    });
  });

  // ── 多場 session 隔離 ─────────────────────────────────────────

  describe('多場 session 不互相干擾', () => {
    it('兩個 DB 實例各自擁有獨立資料', () => {
      // 第一個 DB / session
      db.startSession();
      db.saveSnapshot(makeSnapshot({ dominant: 'hype', messageCount: 10 }));
      const session1Id = db.getSessionId();

      // 第二個 DB（另一個臨時檔案）
      const tmpDir2 = mkdtempSync(join(tmpdir(), 'cmm-test2-'));
      const dbPath2 = join(tmpDir2, 'test2.db');
      const db2 = new SessionDB(dbPath2);

      try {
        db2.startSession();
        db2.saveSnapshot(makeSnapshot({ dominant: 'funny', messageCount: 5 }));
        const session2Id = db2.getSessionId();

        // 兩個 session ID 不同
        expect(session1Id).not.toBe(session2Id);

        // DB1 的快照不出現在 DB2
        const snaps1 = db.getSnapshots(session1Id);
        const snaps2 = db2.getSnapshots(session2Id);
        expect(snaps1.length).toBe(1);
        expect(snaps2.length).toBe(1);
        expect(snaps1[0].dominant).toBe('hype');
        expect(snaps2[0].dominant).toBe('funny');
      } finally {
        db2.close();
        rmSync(tmpDir2, { recursive: true, force: true });
      }
    });

    it('同一 DB 中兩個 session 的快照互不干擾', () => {
      // 第一個 session
      db.startSession();
      db.saveSnapshot(makeSnapshot({ dominant: 'hype' }));
      db.saveSnapshot(makeSnapshot({ dominant: 'hype' }));
      const session1Id = db.getSessionId();
      db.endSession();

      // 關閉並重新開啟，模擬第二場直播（新 sessionId）
      db.close();

      // 以同一 dbPath 開新 DB 實例（會有新 sessionId）
      const db3 = new SessionDB(dbPath);
      try {
        db3.startSession();
        db3.saveSnapshot(makeSnapshot({ dominant: 'funny' }));
        const session3Id = db3.getSessionId();

        // 驗證資料隔離
        const snaps1 = db3.getSnapshots(session1Id);
        const snaps3 = db3.getSnapshots(session3Id);
        expect(snaps1.length).toBe(2);
        expect(snaps3.length).toBe(1);
        expect(snaps1.every(s => s.dominant === 'hype')).toBe(true);
        expect(snaps3[0].dominant).toBe('funny');

        // 全部 sessions 列出
        const all = db3.listSessions();
        expect(all.length).toBe(2);
      } finally {
        db3.close();
        // 重設 db 參考避免 afterEach 重複 close
        (db as unknown as { close: () => void }).close = () => {};
      }
    });
  });

  // ── close() ──────────────────────────────────────────────────

  describe('close()', () => {
    it('關閉後不拋錯', () => {
      expect(() => db.close()).not.toThrow();
    });
  });
});
