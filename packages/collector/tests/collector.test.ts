/**
 * collector.test.ts — Collector + TwitchCollector 單元測試
 *
 * 純建構子與方法測試，不建立實際 Twitch 連線。
 * TwitchCollector.start() 會 dynamic import tmi.js 並嘗試連線，
 * 因此不呼叫 start()，只驗證建構與 EventEmitter 行為。
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Collector } from '../src/index.js';
import { TwitchCollector } from '../src/twitch.js';
import type { Config } from '@cmm/core';

// ── 測試用 Config ─────────────────────────────────────────────

/**
 * 最小化測試 Config。
 * 所有平台設為停用，確保 Collector.start() 不會實際連線。
 */
function makeConfig(): Config {
  return {
    platforms: {
      twitch:  { enabled: false, channel: 'testchannel', token: '' },
      youtube: { enabled: false, liveChatId: '', apiKey: '' },
    },
    analyzer: { mode: 'rules', snapshotIntervalMs: 1000 },
    highlight: {
      windowSec:           10,
      densityMultiplier:   1.5,
      intensityThreshold:  0.7,
      cooldownSec:         30,
    },
    overlay:  { port: 0, historyMinutes: 60 },
    obs:      { enabled: false, host: 'localhost', port: 4455, password: '' },
    storage:  { dbPath: './data/sessions.db' },
  };
}

// ── Collector 測試 ────────────────────────────────────────────

describe('Collector', () => {

  it('建構子不拋錯', () => {
    // 直接建立實例，不呼叫 start()
    const collector = new Collector(makeConfig());
    expect(collector).toBeDefined();
  });

  it('是 EventEmitter 的實例', () => {
    const collector = new Collector(makeConfig());
    // Collector 繼承 EventEmitter，應可通過 instanceof 檢查
    expect(collector).toBeInstanceOf(EventEmitter);
  });

  it('可以用 on() 監聽事件，emit() 觸發後正確執行 handler', () => {
    const collector = new Collector(makeConfig());
    let callCount = 0;

    // 監聽自定義事件
    collector.on('test-event', () => { callCount++; });
    collector.emit('test-event');
    collector.emit('test-event');

    expect(callCount).toBe(2);
  });

  it('可以用 once() 監聽事件，只觸發一次', () => {
    const collector = new Collector(makeConfig());
    let callCount = 0;

    collector.once('one-shot', () => { callCount++; });
    collector.emit('one-shot');
    collector.emit('one-shot'); // 第二次應不觸發

    expect(callCount).toBe(1);
  });

  it('可以用 off() 移除監聽器', () => {
    const collector = new Collector(makeConfig());
    let callCount = 0;

    const handler = () => { callCount++; };
    collector.on('removable', handler);
    collector.emit('removable'); // 第一次觸發
    collector.off('removable', handler);
    collector.emit('removable'); // 移除後不應再觸發

    expect(callCount).toBe(1);
  });
});

// ── TwitchCollector 測試 ──────────────────────────────────────

describe('TwitchCollector', () => {

  it('建構子不拋錯', () => {
    const tc = new TwitchCollector({ channel: 'testchannel' });
    expect(tc).toBeDefined();
  });

  it('是 EventEmitter 的實例', () => {
    const tc = new TwitchCollector({ channel: 'testchannel' });
    expect(tc).toBeInstanceOf(EventEmitter);
  });

  it('可以監聽並觸發自定義事件', () => {
    const tc = new TwitchCollector({ channel: 'testchannel' });
    const received: string[] = [];

    tc.on('custom', (val: string) => { received.push(val); });
    tc.emit('custom', 'hello');
    tc.emit('custom', 'world');

    expect(received).toEqual(['hello', 'world']);
  });

  it('stop() 在未連線狀態下不拋錯', async () => {
    const tc = new TwitchCollector({ channel: 'testchannel' });
    // 未呼叫 start()，直接 stop() 應優雅處理空 client
    await expect(tc.stop()).resolves.not.toThrow();
  });

  it('stop() 連續呼叫兩次不拋錯', async () => {
    const tc = new TwitchCollector({ channel: 'testchannel' });
    await tc.stop();
    await expect(tc.stop()).resolves.not.toThrow();
  });

  it('頻道名稱自動轉小寫並補 # 前綴', () => {
    const tc = new TwitchCollector({ channel: 'TestChannel' });
    // 存取私有欄位 channel 驗證正規化結果
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tc as any).channel).toBe('#testchannel');
  });

  it('頻道名稱已有 # 前綴時不重複加', () => {
    const tc = new TwitchCollector({ channel: '#AlreadyHashed' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tc as any).channel).toBe('#alreadyhashed');
  });

  it('可接受帶 token 的 options', () => {
    // 只驗證建構不拋錯
    const tc = new TwitchCollector({
      channel:  'mychannel',
      token:    'oauth:dummy_token',
      identity: { username: 'mybot', password: 'oauth:dummy_token' },
    });
    expect(tc).toBeDefined();
  });
});
