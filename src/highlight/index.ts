/**
 * highlight/index.ts — M4 Highlight Detector 模組入口
 *
 * 匯出：
 * - HighlightDetector：高光偵測引擎
 * - OBSMarker：OBS WebSocket 時間戳標記器
 * - setupHighlight：便利函式，一次串接 analyzer → detector → server + OBS
 */

import type { Config, EmotionSnapshot, HighlightMarker } from '../types.js';
import type { RulesAnalyzer } from '../analyzer/rules.js';
import type { MoodServer } from '../server.js';
import { HighlightDetector } from './detector.js';
import { OBSMarker } from './obs-marker.js';

// 重新匯出，讓使用方可以從單一入口取得
export { HighlightDetector } from './detector.js';
export { OBSMarker } from './obs-marker.js';

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
 * @param analyzer  已建立的 RulesAnalyzer（或任何 emit 'snapshot' 的 EventEmitter）
 * @param server    MoodServer 實例，用來向 overlay client 推送 highlight 事件
 * @param obsMarker OBSMarker 實例（已呼叫 connect() 或尚未連線均可）
 * @param config    完整 Config 物件，用來建立 HighlightDetector
 * @returns         建立好的 HighlightDetector（方便外部進一步監聽或停用）
 */
export function setupHighlight(
  analyzer: RulesAnalyzer,
  server: MoodServer,
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
