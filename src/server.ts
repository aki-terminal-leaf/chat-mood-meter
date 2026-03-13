/**
 * server.ts — WebSocket + HTTP 靜態檔案伺服器
 *
 * 功能：
 * 1. WebSocket server：接收 analyzer 推入的 EmotionSnapshot / HighlightMarker，
 *    以及轉發 ChatMessage，broadcast 給所有已連線的 overlay client。
 * 2. HTTP server：提供 overlay/ 目錄的靜態檔案服務（GET 請求）。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, WSEvent, EmotionSnapshot, HighlightMarker, ChatMessage } from './types.js';

// ws 套件型別（套件尚未安裝，先用寬鬆宣告）
type WsServer = {
  clients: Set<WsSocket>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  handleUpgrade(
    req: http.IncomingMessage,
    socket: unknown,
    head: Buffer,
    cb: (ws: WsSocket) => void
  ): void;
};

type WsSocket = {
  readyState: number;
  send(data: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

// MIME type 對照表（靜態檔案服務用）
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MoodServer
 * 建立並管理 HTTP + WebSocket 雙功能伺服器。
 */
export class MoodServer {
  private config: Config;
  private httpServer: http.Server | null = null;
  private wss: WsServer | null = null;
  private overlayDir: string;

  constructor(config: Config) {
    this.config = config;
    // overlay 目錄預設為專案根目錄下的 overlay/
    this.overlayDir = path.resolve(__dirname, '..', 'overlay');
  }

  /** 啟動 HTTP + WebSocket 伺服器 */
  async start(): Promise<void> {
    const port = this.config.overlay.port;

    // 建立 HTTP server，處理靜態檔案請求
    this.httpServer = http.createServer((req, res) => {
      this.handleHttp(req, res);
    });

    // 動態 import ws（允許套件尚未安裝時延遲失敗）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { WebSocketServer } = await import('ws') as any;
    this.wss = new WebSocketServer({ noServer: true }) as WsServer;

    // 綁定 WebSocket 事件
    this.wss.on('connection', (ws: unknown) => {
      const socket = ws as WsSocket;
      console.log('[Server] 新 WebSocket 連線');
      socket.on('close', () => {
        console.log('[Server] WebSocket 連線關閉');
      });
      socket.on('error', (err: unknown) => {
        console.error('[Server] WebSocket 錯誤：', err);
      });
    });

    // 升級 HTTP → WebSocket
    this.httpServer.on('upgrade', (req, socket, head) => {
      this.wss!.handleUpgrade(req, socket, head as Buffer, (ws) => {
        (this.wss as unknown as { emit: (event: string, ...args: unknown[]) => void })
          .emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, () => {
        console.log(`[Server] 伺服器已啟動：http://localhost:${port}`);
        resolve();
      });
      this.httpServer!.once('error', reject);
    });
  }

  /** 停止伺服器 */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ──────────────────────────────────────────
  // 對外推送方法（供 analyzer / collector 呼叫）
  // ──────────────────────────────────────────

  /** 推送情緒快照給所有 client */
  pushSnapshot(snapshot: EmotionSnapshot): void {
    const event: WSEvent = { type: 'snapshot', data: snapshot };
    this.broadcast(event);
  }

  /** 推送高光標記給所有 client */
  pushHighlight(marker: HighlightMarker): void {
    const event: WSEvent = { type: 'highlight', data: marker };
    this.broadcast(event);
  }

  /** 轉發聊天訊息給所有 client */
  pushChat(msg: ChatMessage): void {
    const event: WSEvent = { type: 'chat', data: msg };
    this.broadcast(event);
  }

  // ──────────────────────────────────────────
  // 內部工具
  // ──────────────────────────────────────────

  /**
   * broadcast — 將 WSEvent 序列化後送給所有 readyState === OPEN 的 client
   */
  private broadcast(event: WSEvent): void {
    if (!this.wss) return;

    const payload = JSON.stringify(event);
    const WS_OPEN = 1; // ws.OPEN 常數

    for (const client of this.wss.clients) {
      if (client.readyState === WS_OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          console.error('[Server] broadcast 失敗：', err);
        }
      }
    }
  }

  /**
   * handleHttp — 靜態檔案服務
   * 只處理 GET 請求，其餘回傳 405。
   */
  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // 解析 URL，防止路徑穿越攻擊
    const rawUrl = req.url ?? '/';
    const urlPath = new URL(rawUrl, 'http://localhost').pathname;
    let filePath = path.normalize(path.join(this.overlayDir, urlPath));

    // 確保路徑在 overlayDir 內
    if (!filePath.startsWith(this.overlayDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // 若請求目錄，自動補 index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    // 讀取並回傳檔案
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }
}
