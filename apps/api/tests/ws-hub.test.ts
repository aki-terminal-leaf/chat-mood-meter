/**
 * ws-hub.test.ts — WSHub 整合測試
 *
 * 需要：
 *   - Redis 在 localhost:6379 運行
 *   - ioredis（root node_modules）
 *   - @fastify/websocket（root node_modules）
 *   - ws（root node_modules，作為測試用 WebSocket client）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { WSHub } from '../src/ws-hub.js';

// ── 輔助工具 ──────────────────────────────────────────────────────────────────

const REDIS_URL = 'redis://localhost:6379';

/** 取得一個隨機可用的本機 port（簡易版：讓 Fastify 自己決定）*/
async function buildTestServer(hub: WSHub): Promise<{ app: ReturnType<typeof Fastify>; port: number }> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  hub.register(app);
  hub.start();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('無法取得測試 server 位址');
  return { app, port: addr.port };
}

/** 建立 WebSocket 連線並等待 OPEN 狀態 */
function connectWS(port: number, channelId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live/${channelId}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** 等待 WebSocket 收到一則訊息，並以字串回傳 */
function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 訊息逾時')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

/** 等待 WebSocket 關閉 */
function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('等待 WebSocket 關閉逾時')), timeoutMs);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

/** 短暫等待，讓非同步事件（如 Redis subscribe callback）有時間處理 */
const tick = (ms = 50) => new Promise<void>(r => setTimeout(r, ms));

// ── 測試套件 ──────────────────────────────────────────────────────────────────

describe('WSHub', () => {
  let hub: WSHub;
  let pub: Redis;       // 用於 publish 訊息的獨立連線
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeEach(async () => {
    hub = new WSHub(REDIS_URL);
    pub = new Redis(REDIS_URL);
    const result = await buildTestServer(hub);
    app = result.app;
    port = result.port;
  });

  afterEach(async () => {
    await hub.stop();
    await app.close();
    pub.disconnect();
  });

  // ── 測試 1：WebSocket 連線 → addClient ──────────────────────────────────────
  it('連線後 getSubscriberCount 應為 1', async () => {
    const ws = await connectWS(port, 'ch-001');
    await tick();

    expect(hub.getSubscriberCount('ch-001')).toBe(1);

    ws.close();
    await waitForClose(ws);
  });

  // ── 測試 2：Redis publish → WebSocket 收到訊息 ─────────────────────────────
  it('Redis publish 後 WebSocket client 應收到相同訊息', async () => {
    const ws = await connectWS(port, 'ch-002');
    await tick(100); // 等 Redis subscribe 完成

    const payload = JSON.stringify({ type: 'snapshot', channelId: 'ch-002', scores: { positive: 0.7 } });
    const received = waitForMessage(ws);
    await pub.publish('live:ch-002', payload);

    expect(await received).toBe(payload);

    ws.close();
    await waitForClose(ws);
  });

  // ── 測試 3：WebSocket 斷線 → removeClient ──────────────────────────────────
  it('斷線後 getSubscriberCount 應為 0', async () => {
    const ws = await connectWS(port, 'ch-003');
    await tick();
    expect(hub.getSubscriberCount('ch-003')).toBe(1);

    ws.close();
    await waitForClose(ws);
    await tick(100); // 等 server 端 close event 處理完

    expect(hub.getSubscriberCount('ch-003')).toBe(0);
  });

  // ── 測試 4：多個 client 訂閱同一 channel → 都收到訊息 ──────────────────────
  it('多個 client 訂閱同一 channel 時，所有人都應收到訊息', async () => {
    const ws1 = await connectWS(port, 'ch-004');
    const ws2 = await connectWS(port, 'ch-004');
    const ws3 = await connectWS(port, 'ch-004');
    await tick(100);

    expect(hub.getSubscriberCount('ch-004')).toBe(3);

    const payload = JSON.stringify({ type: 'highlight', text: '好棒！' });
    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);
    const p3 = waitForMessage(ws3);

    await pub.publish('live:ch-004', payload);

    const [m1, m2, m3] = await Promise.all([p1, p2, p3]);
    expect(m1).toBe(payload);
    expect(m2).toBe(payload);
    expect(m3).toBe(payload);

    ws1.close(); ws2.close(); ws3.close();
    await Promise.all([waitForClose(ws1), waitForClose(ws2), waitForClose(ws3)]);
  });

  // ── 測試 5：getSubscriberCount 正確反映訂閱者數 ────────────────────────────
  it('部分 client 斷線後 getSubscriberCount 應正確遞減', async () => {
    const ws1 = await connectWS(port, 'ch-005');
    const ws2 = await connectWS(port, 'ch-005');
    await tick();
    expect(hub.getSubscriberCount('ch-005')).toBe(2);

    ws1.close();
    await waitForClose(ws1);
    await tick(100);
    expect(hub.getSubscriberCount('ch-005')).toBe(1);

    ws2.close();
    await waitForClose(ws2);
    await tick(100);
    expect(hub.getSubscriberCount('ch-005')).toBe(0);
  });

  // ── 測試 6：沒有訂閱者的 channel 不處理 Redis 訊息 ────────────────────────
  it('沒有訂閱者的 channel publish 後，其他 channel 的 client 不應收到訊息', async () => {
    const ws = await connectWS(port, 'ch-006');
    await tick(100);

    // 向不同的 channel 發佈訊息
    const unexpectedPayload = JSON.stringify({ type: 'snapshot', channelId: 'ch-999' });
    await pub.publish('live:ch-999', unexpectedPayload);

    // 等待一段時間，確認 ws (ch-006) 什麼都沒收到
    // waitForMessage 逾時會 reject，需用 .catch() 轉成 'timeout'
    const result = await Promise.race([
      waitForMessage(ws, 300).then(() => 'received').catch(() => 'timeout'),
      tick(400).then(() => 'timeout'),
    ]);

    expect(result).toBe('timeout');

    ws.close();
    await waitForClose(ws);
  });
});
