/**
 * index.ts — 主入口
 *
 * 啟動順序：
 * 1. 載入 config/default.json
 * 2. 啟動 MoodServer（HTTP + WebSocket）
 * 3. 啟動 Collector（Twitch / YouTube）
 * 4. 啟動 Analyzer → Highlight → Storage 完整管線
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, ChatMessage } from './types.js';
import { Collector } from './collector/index.js';
import { MoodServer } from './server.js';
import { createAnalyzer, type RulesAnalyzer } from './analyzer/index.js';
import { setupHighlight, OBSMarker } from './highlight/index.js';
import { setupStorage } from './storage/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────
// 載入設定檔
// ──────────────────────────────────────────

function loadConfig(): Config {
  const configPath = resolve(__dirname, '..', 'config', 'default.json');
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as Config;
}

// ──────────────────────────────────────────
// 主程式
// ──────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Main] chat-mood-meter 啟動中...');

  const config = loadConfig();

  // 1. 啟動 WebSocket + HTTP 伺服器
  const server = new MoodServer(config);
  await server.start();

  // 2. 建立 Analyzer
  const analyzer = createAnalyzer(config) as RulesAnalyzer;

  // 3. 建立 OBS Marker
  const obsMarker = new OBSMarker(config);
  await obsMarker.connect();

  // 4. 串接 Highlight 偵測（analyzer → detector → server + obs）
  const detector = setupHighlight(analyzer, server, obsMarker, config);

  // 5. 串接 Storage
  const storage = setupStorage(server, config);

  // 6. Analyzer snapshot → server 推送 + storage 寫入
  analyzer.on('snapshot', (snapshot) => {
    server.pushSnapshot(snapshot);
    storage.saveSnapshot(snapshot);
  });

  // 6b. Highlight → storage 寫入
  detector.on('highlight', (marker) => {
    storage.saveHighlight(marker);
    console.log(`[Highlight] 🎯 ${marker.emotion.toUpperCase()} ${(marker.intensity * 100).toFixed(0)}% @ ${new Date(marker.timestamp).toISOString()}`);
  });

  // 7. 啟動 Analyzer
  analyzer.start();

  // 8. 啟動聊天收集器
  const collector = new Collector(config);
  let msgCount = 0;

  collector.on('message', (msg: ChatMessage) => {
    msgCount++;
    if (msgCount <= 3) {
      console.log(`[Chat] ${msg.user}: ${msg.text}`);
    } else if (msgCount === 4) {
      console.log('[Chat] （後續訊息省略 log...）');
    }
    // 轉發 chat 訊息給 overlay
    server.pushChat(msg);
    // 送進 analyzer
    analyzer.feed(msg);
  });

  collector.on('connected', (info: unknown) => {
    console.log('[Main] Collector 已連線：', info);
  });

  collector.on('disconnected', (info: unknown) => {
    console.warn('[Main] Collector 斷線：', info);
  });

  collector.on('error', (err: unknown) => {
    console.error('[Main] Collector 錯誤：', err);
  });

  await collector.start();
  console.log('[Main] 全部模組啟動完成。');
  console.log(`[Main] Overlay: http://localhost:${config.overlay.port}/`);

  // ──────────────────────────────────────────
  // 優雅關機
  // ──────────────────────────────────────────

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Main] 收到 ${signal}，正在關閉...`);
    analyzer.stop();
    await collector.stop();
    await obsMarker.disconnect();
    storage.endSession();
    storage.db.close();
    await server.stop();
    console.log('[Main] 已安全關閉。');
    process.exit(0);
  }

  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main().catch((err) => {
  console.error('[Main] 啟動失敗：', err);
  process.exit(1);
});
