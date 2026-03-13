/**
 * highlight/index.ts — M4 Highlight Detector 模組入口
 *
 * 匯出：
 * - HighlightDetector：高光偵測引擎
 * - OBSMarker：OBS WebSocket 時間戳標記器
 * - setupHighlight：便利函式，一次串接 analyzer → detector → server + OBS
 *
 * 注意：packages/core 版本使用 HighlightServer 介面取代具體的 MoodServer，
 * 讓 core 不依賴 server 層的實作。
 */

import type { Config, EmotionSnapshot, HighlightMarker } from '../types.js';
import { HighlightDetector } from './detector.js';
import { OBSMarker } from './obs-marker.js';

// 重新匯出，讓使用方可以從單一入口取得
export { HighlightDetector } from './detector.js';
export { OBSMarker } from './obs-marker.js';

// ─────────────────────────────────────────────
// 通用 Server 介面（取代直接依賴 MoodServer）
// ─────────────────────────────────────────────

/**
 * 任何能接收 highlight marker 的 server 都可以實作這個介面
 * MoodServer 只需要實作 pushHighlight 就能直接傳入
 */
export interface HighlightServer {
  pushHighlight(marker: HighlightMarker): void;
}

// ─────────────────────────────────────────────
// setupHighlight — 一鍵接線函式
// ─────────────────────────────────────────────

/**
 * 串接 analyzer、server、OBSMarker 與 HighlightDetector。
 *
 * 資料流：
 *   analyzer  --'snapshot'--> HighlightDetector.feed()
 *   HighlightDetector --'highlight'--> server.pushHighlight() + obsMarker.createMarker()
 *
 * @param analyzer  任何 emit 'snapshot' 事件的 EventEmitter（RulesAnalyzer / LLMAnalyzer）
 * @param server    實作 HighlightServer 介面的物件（MoodServer 即符合）
 * @param obsMarker OBSMarker 實例（已呼叫 connect() 或尚未連線均可）
 * @param config    完整 Config 物件，用來建立 HighlightDetector
 * @returns         建立好的 HighlightDetector（方便外部進一步監聽或停用）
 */
export function setupHighlight(
  analyzer: { on(event: 'snapshot', listener: (snapshot: EmotionSnapshot) => void): unknown },
  server: HighlightServer,
  obsMarker: OBSMarker,
  config: Config
): HighlightDetector {
  const detector = new HighlightDetector(config);

  // ── 監聽 analyzer 的 'snapshot' 事件，將快照餵給偵測器
  analyzer.on('snapshot', (snapshot: EmotionSnapshot) => {
    detector.feed(snapshot);
  });

  // ── 偵測器觸發 'highlight' → 推送給 overlay client + 呼叫 OBS 標記
  detector.on('highlight', async (marker: HighlightMarker) => {
    // 推送到 WebSocket overlay（非同步但不需 await，避免阻塞 event loop）
    server.pushHighlight(marker);

    // 建立 OBS 章節標記（標籤格式：情緒 emoji + 類型 + intensity 百分比）
    const label = buildMarkerLabel(marker.emotion, marker.intensity);
    await obsMarker.createMarker(label);
  });

  console.log('[Highlight] M4 高光偵測已啟動');
  return detector;
}

// ─────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────

/**
 * 產生人類可讀的 OBS 標記標籤
 * 例如：「🔥 HYPE 85%」、「😂 FUNNY 72%」
 */
function buildMarkerLabel(emotion: string, intensity: number): string {
  const emojiMap: Record<string, string> = {
    hype:    '🔥',
    funny:   '😂',
    sad:     '😢',
    angry:   '😡',
    neutral: '💬',
  };
  const emoji = emojiMap[emotion] ?? '⭐';
  const pct   = Math.round(intensity * 100);
  return `${emoji} ${emotion.toUpperCase()} ${pct}%`;
}
