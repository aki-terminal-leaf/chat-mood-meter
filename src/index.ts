/**
 * index.ts — 主入口
 *
 * 啟動順序：
 * 1. 載入 config/default.json
 * 2. 啟動 MoodServer（HTTP + WebSocket）
 * 3. 啟動 Collector（Twitch / YouTube）
 * 4. 每條 ChatMessage → analyzer（placeholder）→ server 推送
 *
 * Analyzer 與 Highlight 模組為 placeholder，
 * 待 M2/M3 實作後替換 import 路徑即可。
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, ChatMessage } from './types.js';
import { Collector } from './collector/index.js';
import { MoodServer } from './server.js';

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
// Analyzer Placeholder（M2 實作後替換）
// ──────────────────────────────────────────

/**
 * 暫時用的 analyzer placeholder。
 * 接收 ChatMessage，回傳 null（不產生快照）。
 * M2 實作後，這裡改成真正的 import 並呼叫。
 */
let analyzerPush: ((msg: ChatMessage) => void) | null = null;

try {
  // 動態 import，讓模組不存在時不影響啟動
  const analyzerMod = await import('./analyzer/index.js').catch(() => null);
  if (analyzerMod && typeof analyzerMod.createAnalyzer === 'function') {
    // analyzerMod.createAnalyzer(config) → { push(msg), onSnapshot(cb), onHighlight(cb) }
    console.log('[Main] Analyzer 模組已載入');
  }
} catch {
  // 模組不存在，使用 placeholder
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

  // 2. 啟動聊天收集器
  const collector = new Collector(config);

  // 3. 處理每條收到的訊息
  collector.on('message', (msg: ChatMessage) => {
    // 3a. 轉發 chat 訊息給 overlay
    server.pushChat(msg);

    // 3b. 送進 analyzer（placeholder：暫時不做任何事）
    if (analyzerPush) {
      analyzerPush(msg);
    }
    // TODO（M2）：analyzer 在累積足夠訊息後，透過 callback 呼叫：
    //   server.pushSnapshot(snapshot);
    //   server.pushHighlight(marker);
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

  // ──────────────────────────────────────────
  // 優雅關機（SIGINT / SIGTERM）
  // ──────────────────────────────────────────

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Main] 收到 ${signal}，正在關閉...`);
    await collector.stop();
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
