/**
 * ws-hub.ts — WebSocket Hub
 *
 * 接收 Redis Pub/Sub 訊息，即時推送給訂閱對應 channelId 的前端 WebSocket 連線。
 *
 * 路由：GET /ws/live/:channelId（WebSocket upgrade）
 *
 * 訊息格式由 worker 決定（JSON string），hub 原封不動轉發。
 */

import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';

export class WSHub {
  private sub: Redis;
  private clients: Map<string, Set<WebSocket>> = new Map(); // channelId → WebSocket set

  constructor(redisUrl: string) {
    // enableReadyCheck: false — 避免 subscriber 模式下發送 INFO 指令引發錯誤
    this.sub = new Redis(redisUrl, { enableReadyCheck: false, lazyConnect: false });
  }

  /**
   * 註冊 Fastify WebSocket 路由。
   * 必須在 app.register(@fastify/websocket) 之後呼叫。
   */
  register(app: FastifyInstance): void {
    app.get(
      '/ws/live/:channelId',
      { websocket: true },
      (socket, request) => {
        const { channelId } = request.params as { channelId: string };
        this.addClient(channelId, socket as unknown as WebSocket);

        socket.on('close', () => this.removeClient(channelId, socket as unknown as WebSocket));
        socket.on('error', () => this.removeClient(channelId, socket as unknown as WebSocket));
      },
    );
  }

  private addClient(channelId: string, ws: WebSocket): void {
    if (!this.clients.has(channelId)) {
      this.clients.set(channelId, new Set());
      // 只在首位訂閱者建立時才向 Redis 訂閱，節省連線資源
      this.sub.subscribe(`live:${channelId}`);
    }
    this.clients.get(channelId)!.add(ws);
  }

  private removeClient(channelId: string, ws: WebSocket): void {
    const set = this.clients.get(channelId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.clients.delete(channelId);
      this.sub.unsubscribe(`live:${channelId}`);
    }
  }

  /**
   * 啟動 Redis 訊息監聽。
   * 建立 WSHub 後需呼叫一次；重複呼叫無害（ioredis 不會重複綁定）。
   */
  start(): void {
    this.sub.on('message', (channel: string, message: string) => {
      const channelId = channel.replace(/^live:/, '');
      const clients = this.clients.get(channelId);
      if (!clients) return;
      for (const ws of clients) {
        if (ws.readyState === 1 /* WebSocket.OPEN */) {
          ws.send(message);
        }
      }
    });
  }

  /**
   * 優雅關閉：斷開 Redis 訂閱連線，並關閉所有 WebSocket。
   */
  async stop(): Promise<void> {
    this.sub.disconnect();
    for (const [, clients] of this.clients) {
      for (const ws of clients) ws.close();
    }
    this.clients.clear();
  }

  /**
   * 取得某 channel 目前的訂閱者數量。
   */
  getSubscriberCount(channelId: string): number {
    return this.clients.get(channelId)?.size ?? 0;
  }
}
