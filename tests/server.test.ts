/**
 * server.test.ts — MoodServer 單元測試
 *
 * 測試 HTTP 靜態檔案服務 + WebSocket 廣播功能。
 * 使用 port 0 讓 OS 自動分配 port，徹底避免衝突。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { MoodServer } from '../src/server.js';
import type { Config, EmotionSnapshot, ChatMessage, HighlightMarker } from '../src/types.js';

// ── 測試用 Config 工廠 ────────────────────────────────────────

/** 建立最小化測試用 Config，port 預設 0（OS 自動分配） */
function makeConfig(port = 0): Config {
  return {
    platforms: {
      twitch:  { enabled: false, channel: '', token: '' },
      youtube: { enabled: false, liveChatId: '', apiKey: '' },
    },
    analyzer: { mode: 'rules', snapshotIntervalMs: 1000 },
    highlight: {
      windowSec: 10,
      densityMultiplier: 1.5,
      intensityThreshold: 0.7,
      cooldownSec: 30,
    },
    overlay: { port, historyMinutes: 60 },
    obs:  { enabled: false, host: 'localhost', port: 4455, password: '' },
    storage: { dbPath: './data/sessions.db' },
  };
}

// ── 工具函式 ──────────────────────────────────────────────────

/**
 * 取得已啟動 MoodServer 實際監聽的 port。
 * 透過存取私有欄位 httpServer（僅在測試中使用）。
 */
function getPort(server: MoodServer): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addr = (server as any).httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('無法取得 port');
  return addr.port as number;
}

/** 等待 WebSocket 連線成功（open 事件） */
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

/** 等待 WebSocket 收到一則訊息，並解析為物件 */
function waitMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.once('error', reject);
  });
}

// ── 假資料 ────────────────────────────────────────────────────

/** 測試用情緒快照 */
const mockSnapshot: EmotionSnapshot = {
  timestamp:    Date.now(),
  dominant:     'hype',
  scores:       { hype: 0.8, funny: 0.1, sad: 0.05, angry: 0.05 },
  intensity:    0.8,
  messageCount: 42,
};

/** 測試用聊天訊息 */
const mockChat: ChatMessage = {
  platform:  'twitch',
  user:      'testUser',
  text:      '測試訊息 PogChamp',
  emotes:    ['PogChamp'],
  timestamp: Date.now(),
};

/** 測試用高光標記 */
const mockHighlight: HighlightMarker = {
  timestamp:      Date.now(),
  emotion:        'hype',
  intensity:      0.9,
  duration:       5000,
  sampleMessages: ['哇好厲害', 'PogChamp', 'wow'],
};

// ── 測試主體 ──────────────────────────────────────────────────

describe('MoodServer', () => {
  let server: MoodServer;

  // 每個測試前重新建立 server 實例（port 0 讓 OS 自動分配）
  beforeEach(() => {
    server = new MoodServer(makeConfig(0));
  });

  // 每個測試後確保 server 已停止，防止資源洩漏
  afterEach(async () => {
    await server.stop();
  });

  // ── 建構子 ────────────────────────────────────────────────────

  it('建構子不拋錯', () => {
    // beforeEach 已建立，確認實例存在即可
    expect(server).toBeDefined();
  });

  // ── start() ───────────────────────────────────────────────────

  it('start() 成功啟動並取得有效 port', async () => {
    await server.start();
    const port = getPort(server);
    // OS 分配的 port 應大於 0
    expect(port).toBeGreaterThan(0);
  });

  it('start() 後 HTTP GET / 回傳 200（靜態檔案服務）', async () => {
    await server.start();
    const port = getPort(server);

    // overlay/index.html 存在於專案根目錄，應正常回傳
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
  });

  // ── push 方法（無 client 連線時不拋錯）────────────────────────

  it('pushChat() 在無 client 連線時不拋錯', async () => {
    await server.start();
    // wss.clients 為空集合，broadcast 應靜默跳過
    expect(() => server.pushChat(mockChat)).not.toThrow();
  });

  it('pushSnapshot() 在無 client 連線時不拋錯', async () => {
    await server.start();
    expect(() => server.pushSnapshot(mockSnapshot)).not.toThrow();
  });

  it('pushHighlight() 在無 client 連線時不拋錯', async () => {
    await server.start();
    expect(() => server.pushHighlight(mockHighlight)).not.toThrow();
  });

  // ── stop() ────────────────────────────────────────────────────

  it('stop() 關閉 server 不拋錯', async () => {
    await server.start();
    // afterEach 也會再呼叫 stop()，確認多次呼叫不會爆炸
    await expect(server.stop()).resolves.not.toThrow();
  });

  // ── WebSocket 連線 ────────────────────────────────────────────

  it('WebSocket client 能成功連線', async () => {
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitOpen(ws);

    // readyState OPEN = 1
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  // ── WebSocket 廣播（pushSnapshot）────────────────────────────

  it('pushSnapshot 後 client 收到 type="snapshot" 訊息', async () => {
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitOpen(ws);

    // 先設定接收 Promise，再推送，避免競態條件
    const msgPromise = waitMessage(ws);
    server.pushSnapshot(mockSnapshot);

    const msg = await msgPromise as { type: string; data: EmotionSnapshot };
    expect(msg.type).toBe('snapshot');
    expect(msg.data.dominant).toBe(mockSnapshot.dominant);
    expect(msg.data.intensity).toBe(mockSnapshot.intensity);

    ws.close();
  });

  // ── WebSocket 廣播（pushChat）─────────────────────────────────

  it('pushChat 後 client 收到 type="chat" 訊息', async () => {
    await server.start();
    const port = getPort(server);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitOpen(ws);

    const msgPromise = waitMessage(ws);
    server.pushChat(mockChat);

    const msg = await msgPromise as { type: string; data: ChatMessage };
    expect(msg.type).toBe('chat');
    expect(msg.data.user).toBe(mockChat.user);
    expect(msg.data.text).toBe(mockChat.text);

    ws.close();
  });
});
