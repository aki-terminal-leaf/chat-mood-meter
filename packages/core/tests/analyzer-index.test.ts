/**
 * analyzer-index.test.ts
 * 測試 createAnalyzer 工廠函式
 *
 * 驗證：
 * - mode='rules' → 回傳正確實例
 * - mode='llm' 缺 apiKey → fallback 到 rules 模式
 * - 回傳的物件是 EventEmitter（具備 on/emit/off 方法）
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createAnalyzer } from '../src/analyzer/index.js';
import { RulesAnalyzer } from '../src/analyzer/rules.js';
import type { Config } from '../src/types.js';

// ─────────────────────────────────────────────
// 測試用 Config 工廠
// ─────────────────────────────────────────────

/**
 * 建立最小可用的 Config 物件
 * 只填 analyzer 區塊，其他欄位填合理預設值
 */
function makeConfig(overrides?: Partial<Config['analyzer']>): Config {
  return {
    platforms: {
      twitch: { enabled: false, channel: '', token: '' },
      youtube: { enabled: false, liveChatId: '', apiKey: '' },
    },
    analyzer: {
      mode: 'rules',
      snapshotIntervalMs: 1000,
      ...overrides,
    },
    highlight: {
      windowSec: 10,
      densityMultiplier: 2,
      intensityThreshold: 0.6,
      cooldownSec: 30,
    },
    overlay: { port: 3000, historyMinutes: 60 },
    obs: { enabled: false, host: 'localhost', port: 4455, password: '' },
    storage: { dbPath: ':memory:' },
  };
}

// ─────────────────────────────────────────────
// mode='rules' 測試
// ─────────────────────────────────────────────

describe("createAnalyzer：mode='rules'", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("應回傳具有 start 方法的物件", () => {
    const config = makeConfig({ mode: 'rules' });
    const analyzer = createAnalyzer(config);
    expect(typeof analyzer.start).toBe('function');
  });

  it("應回傳具有 stop 方法的物件", () => {
    const config = makeConfig({ mode: 'rules' });
    const analyzer = createAnalyzer(config);
    expect(typeof analyzer.stop).toBe('function');
  });

  it("應回傳具有 feed 方法的物件", () => {
    const config = makeConfig({ mode: 'rules' });
    const analyzer = createAnalyzer(config);
    expect(typeof analyzer.feed).toBe('function');
  });

  it("回傳的物件應是 RulesAnalyzer 實例", () => {
    const config = makeConfig({ mode: 'rules' });
    const analyzer = createAnalyzer(config);
    expect(analyzer).toBeInstanceOf(RulesAnalyzer);
  });

  it("回傳的物件應繼承自 EventEmitter", () => {
    const config = makeConfig({ mode: 'rules' });
    const analyzer = createAnalyzer(config);
    expect(analyzer).toBeInstanceOf(EventEmitter);
  });
});

// ─────────────────────────────────────────────
// mode='llm' 缺少 apiKey → fallback 測試
// ─────────────────────────────────────────────

describe("createAnalyzer：mode='llm' 缺少 apiKey → fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode='llm' 但未提供 llm 設定時，應 fallback 到 RulesAnalyzer", () => {
    // 攔截 console.warn，確認有警告訊息
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = makeConfig({ mode: 'llm' }); // 沒有 llm.apiKey
    const analyzer = createAnalyzer(config);

    // fallback 到 rules，應是 RulesAnalyzer
    expect(analyzer).toBeInstanceOf(RulesAnalyzer);
    // 應有警告訊息
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('apiKey')
    );
  });

  it("mode='llm' 但 apiKey 為空字串時，應 fallback 到 RulesAnalyzer", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = makeConfig({
      mode: 'llm',
      llm: { apiKey: '' }, // 空字串視為未設定
    });
    const analyzer = createAnalyzer(config);

    expect(analyzer).toBeInstanceOf(RulesAnalyzer);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fallback 的 RulesAnalyzer 也應是 EventEmitter", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = makeConfig({ mode: 'llm' });
    const analyzer = createAnalyzer(config);

    expect(analyzer).toBeInstanceOf(EventEmitter);
  });

  it("fallback 的 RulesAnalyzer 應具有 start/stop/feed 方法", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = makeConfig({ mode: 'llm' });
    const analyzer = createAnalyzer(config);

    expect(typeof analyzer.start).toBe('function');
    expect(typeof analyzer.stop).toBe('function');
    expect(typeof analyzer.feed).toBe('function');
  });
});

// ─────────────────────────────────────────────
// EventEmitter 介面驗證
// ─────────────────────────────────────────────

describe('createAnalyzer：回傳的物件是 EventEmitter', () => {
  it("應具有 on() 方法", () => {
    const analyzer = createAnalyzer(makeConfig({ mode: 'rules' }));
    expect(typeof analyzer.on).toBe('function');
  });

  it("應具有 off() 方法", () => {
    const analyzer = createAnalyzer(makeConfig({ mode: 'rules' }));
    expect(typeof analyzer.off).toBe('function');
  });

  it("應具有 emit() 方法", () => {
    const analyzer = createAnalyzer(makeConfig({ mode: 'rules' }));
    expect(typeof analyzer.emit).toBe('function');
  });

  it("應能透過 on('snapshot', ...) 監聽 snapshot 事件", () => {
    vi.useFakeTimers();

    const analyzer = createAnalyzer(makeConfig({
      mode: 'rules',
      snapshotIntervalMs: 1000,
    }));

    const received: unknown[] = [];
    analyzer.on('snapshot', (snap) => received.push(snap));

    analyzer.start();
    vi.advanceTimersByTime(2000); // 推進 2 秒，應觸發 2 次
    analyzer.stop();

    expect(received.length).toBe(2);

    vi.useRealTimers();
  });

  it("off() 應能移除監聽器，停止接收 snapshot", () => {
    vi.useFakeTimers();

    const analyzer = createAnalyzer(makeConfig({
      mode: 'rules',
      snapshotIntervalMs: 1000,
    }));

    const received: unknown[] = [];
    const listener = (snap: unknown) => received.push(snap);
    analyzer.on('snapshot', listener);

    analyzer.start();
    vi.advanceTimersByTime(1000); // 收到 1 次

    // 移除監聽器
    analyzer.off('snapshot', listener);
    vi.advanceTimersByTime(2000); // 之後不應再收到

    analyzer.stop();

    expect(received.length).toBe(1);

    vi.useRealTimers();
  });
});
