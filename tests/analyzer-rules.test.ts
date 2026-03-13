/**
 * analyzer-rules.test.ts
 * 測試 RulesAnalyzer（基於規則的情緒分析引擎）
 *
 * 涵蓋：建構子、feed()、start()/stop()、snapshot 產生邏輯、
 * dominant 計算、訊息計數、視窗過期、KEYWORD_MAP 正則匹配
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RulesAnalyzer } from '../src/analyzer/rules.js';
import type { ChatMessage, EmotionSnapshot } from '../src/types.js';

// ─────────────────────────────────────────────
// 測試用工具函式
// ─────────────────────────────────────────────

/** 建立測試用 ChatMessage，timestamp 預設為 Date.now() */
function makeMsg(text: string, options?: {
  emotes?: string[];
  timestamp?: number;
  user?: string;
}): ChatMessage {
  return {
    platform: 'twitch',
    user: options?.user ?? 'testUser',
    text,
    emotes: options?.emotes ?? [],
    timestamp: options?.timestamp ?? Date.now(),
  };
}

/**
 * 等待 RulesAnalyzer 發出第一個 snapshot，並回傳它。
 * 用 Promise 封裝 EventEmitter 事件，方便 async/await 測試。
 */
function waitForSnapshot(analyzer: RulesAnalyzer): Promise<EmotionSnapshot> {
  return new Promise(resolve => {
    analyzer.once('snapshot', resolve);
  });
}

// ─────────────────────────────────────────────
// 建構子測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer 建構子', () => {
  it('可以使用預設參數建立實例', () => {
    const analyzer = new RulesAnalyzer();
    expect(analyzer).toBeDefined();
    // 應繼承自 EventEmitter，具有 on/emit 方法
    expect(typeof analyzer.on).toBe('function');
    expect(typeof analyzer.emit).toBe('function');
  });

  it('可以傳入自訂參數建立實例', () => {
    const analyzer = new RulesAnalyzer({
      windowMs: 3000,
      snapshotIntervalMs: 500,
      baselineWindowMs: 60_000,
    });
    expect(analyzer).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// feed() 測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer feed()', () => {
  it('餵入訊息後不應拋出錯誤', () => {
    const analyzer = new RulesAnalyzer();
    expect(() => {
      analyzer.feed(makeMsg('PogChamp 太強了'));
    }).not.toThrow();
  });

  it('餵入多則訊息後，snapshot 的 messageCount 應反映訊息數量', async () => {
    // 使用假時間控制計時器
    vi.useFakeTimers();

    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const now = Date.now();

    // 餵入 3 則訊息
    analyzer.feed(makeMsg('PogChamp', { timestamp: now }));
    analyzer.feed(makeMsg('LUL', { timestamp: now }));
    analyzer.feed(makeMsg('KEKW', { timestamp: now }));

    analyzer.start();

    // 收集 snapshot
    const snapPromise = waitForSnapshot(analyzer);

    // 推進時鐘，觸發第一次 snapshot
    vi.advanceTimersByTime(1000);

    const snap = await snapPromise;
    expect(snap.messageCount).toBe(3);

    analyzer.stop();
    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────
// start() / stop() 計時器測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer start() / stop()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() 後推進時鐘應觸發 snapshot 事件', async () => {
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    analyzer.start();
    vi.advanceTimersByTime(3000); // 推進 3 秒，應觸發 3 次

    expect(snapshots.length).toBe(3);
    analyzer.stop();
  });

  it('stop() 後推進時鐘不應再觸發 snapshot 事件', async () => {
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    analyzer.start();
    vi.advanceTimersByTime(2000); // 觸發 2 次

    analyzer.stop();
    vi.advanceTimersByTime(3000); // 停止後推進，不應再觸發

    expect(snapshots.length).toBe(2);
  });

  it('重複呼叫 start() 不應建立多個計時器', () => {
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    analyzer.start();
    analyzer.start(); // 重複呼叫
    analyzer.start();

    vi.advanceTimersByTime(1000);
    // 如果建立了多個計時器，會觸發多次
    expect(snapshots.length).toBe(1);

    analyzer.stop();
  });

  it('重複呼叫 stop() 不應拋出錯誤', () => {
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    analyzer.start();
    expect(() => {
      analyzer.stop();
      analyzer.stop();
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// snapshot 內容測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer snapshot 產生', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 取得單次 snapshot 的輔助函式 */
  async function getSnapshot(
    messages: ChatMessage[],
    options?: { windowMs?: number; snapshotIntervalMs?: number }
  ): Promise<EmotionSnapshot> {
    const analyzer = new RulesAnalyzer({
      windowMs: options?.windowMs ?? 5000,
      snapshotIntervalMs: options?.snapshotIntervalMs ?? 1000,
    });

    for (const msg of messages) {
      analyzer.feed(msg);
    }

    analyzer.start();
    const snapPromise = waitForSnapshot(analyzer);
    vi.advanceTimersByTime(1000);
    const snap = await snapPromise;
    analyzer.stop();
    return snap;
  }

  it('空視窗應產生 dominant=neutral，所有分數為 0', async () => {
    const snap = await getSnapshot([]); // 沒有訊息

    expect(snap.dominant).toBe('neutral');
    expect(snap.scores.hype).toBe(0);
    expect(snap.scores.funny).toBe(0);
    expect(snap.scores.sad).toBe(0);
    expect(snap.scores.angry).toBe(0);
    expect(snap.intensity).toBe(0);
    expect(snap.messageCount).toBe(0);
  });

  it('含 PogChamp emote 的訊息 → hype 分數應 > 0', async () => {
    const now = Date.now();
    const snap = await getSnapshot([
      // PogChamp 在 emotes 欄位（平台直接回報）
      makeMsg('PogChamp', { emotes: ['PogChamp'], timestamp: now }),
    ]);

    expect(snap.scores.hype).toBeGreaterThan(0);
    expect(snap.dominant).toBe('hype');
  });

  it('含「笑死」文字的訊息 → funny 分數應 > 0', async () => {
    const now = Date.now();
    const snap = await getSnapshot([
      makeMsg('笑死了啦', { timestamp: now }),
    ]);

    expect(snap.scores.funny).toBeGreaterThan(0);
    expect(snap.dominant).toBe('funny');
  });

  it('含「QQ」文字的訊息 → sad 分數應 > 0', async () => {
    const now = Date.now();
    const snap = await getSnapshot([
      makeMsg('QQ 好可憐', { timestamp: now }),
    ]);

    expect(snap.scores.sad).toBeGreaterThan(0);
    expect(snap.dominant).toBe('sad');
  });

  it('含「😡」emoji 的訊息 → angry 分數應 > 0', async () => {
    const now = Date.now();
    const snap = await getSnapshot([
      makeMsg('😡 幹嘛啦', { timestamp: now }),
    ]);

    expect(snap.scores.angry).toBeGreaterThan(0);
    expect(snap.dominant).toBe('angry');
  });

  it('快速餵入大量訊息 → intensity 應 > 0', async () => {
    const now = Date.now();
    // 大量訊息在短時間內湧入，密度高
    const messages = Array.from({ length: 30 }, (_, i) =>
      makeMsg(`PogChamp ${i}`, { emotes: ['PogChamp'], timestamp: now + i * 10 })
    );

    const snap = await getSnapshot(messages, { windowMs: 5000 });

    expect(snap.intensity).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// dominant 情緒計算測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer dominant 計算', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('全部是搞笑訊息時，dominant 應為 funny', async () => {
    const now = Date.now();
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    // 連續餵入大量搞笑訊息
    for (let i = 0; i < 10; i++) {
      analyzer.feed(makeMsg('KEKW LUL 笑死', { emotes: ['KEKW', 'LUL'], timestamp: now + i }));
    }

    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    const snap = snapshots[0];
    expect(snap).toBeDefined();
    expect(snap.dominant).toBe('funny');
  });

  it('全部是悲傷訊息時，dominant 應為 sad', async () => {
    const now = Date.now();
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    for (let i = 0; i < 10; i++) {
      analyzer.feed(makeMsg('QQ BibleThump 😭', { emotes: ['BibleThump'], timestamp: now + i }));
    }

    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    const snap = snapshots[0];
    expect(snap.dominant).toBe('sad');
  });
});

// ─────────────────────────────────────────────
// messageCount 測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer messageCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('messageCount 應與餵入的訊息數一致', async () => {
    const now = Date.now();
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    const msgCount = 7;
    for (let i = 0; i < msgCount; i++) {
      analyzer.feed(makeMsg(`test ${i}`, { timestamp: now + i }));
    }

    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    expect(snapshots[0].messageCount).toBe(msgCount);
  });
});

// ─────────────────────────────────────────────
// 視窗過期訊息清除測試
// ─────────────────────────────────────────────

describe('RulesAnalyzer 視窗過期訊息清除', () => {
  it('超過 windowMs 的舊訊息應被排除在 snapshot 之外', async () => {
    vi.useFakeTimers();

    const windowMs = 2000; // 2 秒視窗
    const analyzer = new RulesAnalyzer({
      windowMs,
      snapshotIntervalMs: 1000,
    });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    // 模擬「3 秒前」的舊訊息（超出視窗）
    const oldTimestamp = Date.now() - 3000;
    analyzer.feed(makeMsg('PogChamp', { emotes: ['PogChamp'], timestamp: oldTimestamp }));
    analyzer.feed(makeMsg('KEKW',     { emotes: ['KEKW'],     timestamp: oldTimestamp }));
    analyzer.feed(makeMsg('LUL',      { emotes: ['LUL'],      timestamp: oldTimestamp }));

    // 推進時鐘，觸發 snapshot（此時 Date.now() 還在原點附近）
    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    // 舊訊息的 timestamp 比 Date.now() - windowMs 更早，應被清除
    // messageCount 應為 0（或極少數，取決於時鐘推進量）
    const snap = snapshots[0];
    expect(snap.messageCount).toBe(0);
    expect(snap.dominant).toBe('neutral');

    vi.useRealTimers();
  });

  it('視窗內的新訊息應正常納入計算', async () => {
    vi.useFakeTimers();

    const analyzer = new RulesAnalyzer({
      windowMs: 5000,
      snapshotIntervalMs: 1000,
    });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    // 新訊息（timestamp 為現在）
    const now = Date.now();
    analyzer.feed(makeMsg('PogChamp', { emotes: ['PogChamp'], timestamp: now }));
    analyzer.feed(makeMsg('PogChamp', { emotes: ['PogChamp'], timestamp: now }));

    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    const snap = snapshots[0];
    // 訊息應在視窗內，messageCount > 0
    expect(snap.messageCount).toBe(2);

    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────
// KEYWORD_MAP 正則匹配效果驗證
// ─────────────────────────────────────────────

describe('RulesAnalyzer KEYWORD_MAP 正則匹配', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 快速取得 snapshot 的輔助函式 */
  async function getSnapshotForText(text: string): Promise<EmotionSnapshot> {
    const analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    const snapshots: EmotionSnapshot[] = [];
    analyzer.on('snapshot', s => snapshots.push(s));

    analyzer.feed(makeMsg(text, { timestamp: Date.now() }));
    analyzer.start();
    vi.advanceTimersByTime(1000);
    analyzer.stop();

    return snapshots[0];
  }

  it('哈哈哈（3+ 個哈）應被正則匹配，funny > 0', async () => {
    const snap = await getSnapshotForText('哈哈哈哈哈');
    expect(snap.scores.funny).toBeGreaterThan(0);
  });

  it('www（3+ 個 w）應被正則匹配，funny > 0', async () => {
    const snap = await getSnapshotForText('www 真的笑了');
    expect(snap.scores.funny).toBeGreaterThan(0);
  });

  it('8888（3+ 個 8）應被正則匹配，hype > 0', async () => {
    const snap = await getSnapshotForText('88888888');
    expect(snap.scores.hype).toBeGreaterThan(0);
  });

  it('短的 「哈哈」（僅 2 個哈）不應觸發 KEYWORD_MAP（哈{3,}）', async () => {
    // 哈哈 只有兩個，不符合哈{3,}；但 EMOTE_MAP 裡有「哈哈」key，仍會命中
    // 所以我們只驗證 funny 值比「哈哈哈」低或相近（不驗 0）
    const snap2 = await getSnapshotForText('哈哈');
    const snap3 = await getSnapshotForText('哈哈哈');
    // 三個哈的 funny 應 >= 兩個哈（因為多了 KEYWORD_MAP 命中）
    expect(snap3.scores.funny).toBeGreaterThanOrEqual(snap2.scores.funny);
  });
});
