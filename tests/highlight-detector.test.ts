/**
 * highlight-detector.test.ts
 * 測試 HighlightDetector 的觸發條件、冷卻機制與 HighlightMarker 結構。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HighlightDetector } from '../src/highlight/detector.js';
import type { EmotionSnapshot, Config } from '../src/types.js';

// ─── 工具函式 ────────────────────────────────────────────────

/**
 * 建立測試用 Config（只填 highlight 區段）
 */
function makeConfig(overrides?: Partial<Config['highlight']>): Pick<Config, 'highlight'> {
  return {
    highlight: {
      windowSec: 30,
      densityMultiplier: 2.5,
      intensityThreshold: 0.8,
      cooldownSec: 60,
      ...overrides,
    },
  };
}

/**
 * 建立測試用 EmotionSnapshot
 */
function makeSnapshot(overrides?: Partial<EmotionSnapshot>): EmotionSnapshot {
  return {
    timestamp: Date.now(),
    dominant: 'hype',
    scores: { hype: 0.5, funny: 0.1, sad: 0.1, angry: 0.1 },
    intensity: 0.5,
    messageCount: 5,
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('HighlightDetector', () => {

  // ── 建構子 ──────────────────────────────────────────────────

  describe('建構子', () => {
    it('應可正常實例化，不拋出例外', () => {
      expect(() => new HighlightDetector(makeConfig())).not.toThrow();
    });

    it('使用傳入的 config 值（不套用預設值覆蓋）', () => {
      // 建構子會 fallback 到預設值，這裡確認自訂值有效
      const cfg = makeConfig({ intensityThreshold: 0.9, cooldownSec: 30 });
      const detector = new HighlightDetector(cfg);
      const listener = vi.fn();
      detector.on('highlight', listener);

      // intensity 0.85 < 0.9（不觸發 intensity）
      // scores 全部很低（不觸發 delta：0.05 - 0 = 0.05 < 0.3）
      // messageCount 低（不觸發密度）
      const snap = makeSnapshot({
        intensity: 0.85,
        scores: { hype: 0.05, funny: 0.05, sad: 0.05, angry: 0.05 },
        messageCount: 2,
      });
      detector.feed(snap);
      // 三條件都不滿足，預期不觸發
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── feed() ──────────────────────────────────────────────────

  describe('feed()', () => {
    it('餵入 snapshot 後不拋出例外', () => {
      const detector = new HighlightDetector(makeConfig());
      expect(() => detector.feed(makeSnapshot())).not.toThrow();
    });

    it('空視窗（無訊息）不觸發 highlight', () => {
      const detector = new HighlightDetector(makeConfig());
      const listener = vi.fn();
      detector.on('highlight', listener);

      // messageCount=0，intensity=0，scores=0 → 三條件都不滿足
      const snap = makeSnapshot({
        dominant: 'hype',
        intensity: 0,
        messageCount: 0,
        scores: { hype: 0, funny: 0, sad: 0, angry: 0 },
      });
      detector.feed(snap);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── 觸發條件：intensity >= threshold ────────────────────────

  describe('觸發條件：intensity >= threshold', () => {
    it('intensity 等於 threshold 時觸發 highlight', () => {
      const detector = new HighlightDetector(makeConfig({ intensityThreshold: 0.8 }));
      const listener = vi.fn();
      detector.on('highlight', listener);

      // intensity 恰好等於 threshold
      detector.feed(makeSnapshot({ intensity: 0.8 }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('intensity 超過 threshold 時觸發 highlight', () => {
      const detector = new HighlightDetector(makeConfig({ intensityThreshold: 0.8 }));
      const listener = vi.fn();
      detector.on('highlight', listener);

      detector.feed(makeSnapshot({ intensity: 0.95 }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('intensity 低於 threshold 時不觸發（無其他條件）', () => {
      const detector = new HighlightDetector(makeConfig({ intensityThreshold: 0.8 }));
      const listener = vi.fn();
      detector.on('highlight', listener);

      // intensity 0.79 < 0.8（不觸發 intensity）
      // scores 全部很低（不觸發 delta：0.05 - 0 = 0.05 < 0.3）
      // messageCount 低（不觸發密度）
      detector.feed(makeSnapshot({
        intensity: 0.79,
        messageCount: 2,
        scores: { hype: 0.05, funny: 0.05, sad: 0.05, angry: 0.05 },
      }));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── 觸發條件：密度突增 ──────────────────────────────────────

  describe('觸發條件：訊息密度突增', () => {
    it('密度超過基線 * multiplier 時觸發', () => {
      // 先用低密度塞滿歷史（建立基線），再送高密度 snapshot
      const detector = new HighlightDetector(
        makeConfig({ densityMultiplier: 2.5, intensityThreshold: 1.0 }) // intensity 門檻設高，排除干擾
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // 先觸發一次讓 densityHistory 有資料（需要 5 筆）
      // 手動塞 5 筆低密度、不觸發 intensity 的 snapshot
      // 注意：第一次觸發後有 60s 冷卻，所以要換不同情緒或等冷卻
      // 這裡先讓第一批用 funny（不同情緒），避免冷卻影響後續 hype 測試
      for (let i = 0; i < 6; i++) {
        detector.feed(makeSnapshot({
          timestamp: base + i * 1000,
          dominant: 'funny',
          intensity: 0.3,   // 不觸發 intensity
          messageCount: 4,  // 基線密度
          scores: { hype: 0.1, funny: 0.3, sad: 0.05, angry: 0.05 },
        }));
      }

      // 清除監聽（前面可能已觸發，我們只關心接下來）
      listener.mockClear();

      // 送一個高密度 hype snapshot（不同情緒，冷卻獨立）
      // 基線 ~4，multiplier 2.5 → 需要 > 10
      detector.feed(makeSnapshot({
        timestamp: base + 10_000,
        dominant: 'hype',
        intensity: 0.3,
        messageCount: 15,  // 遠超基線
        scores: { hype: 0.3, funny: 0.1, sad: 0.05, angry: 0.05 },
      }));

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── 觸發條件：情緒 delta ─────────────────────────────────────

  describe('觸發條件：情緒 delta > 0.3', () => {
    it('dominant 情緒分數跳升 > 0.3 時觸發', () => {
      // 使用短 windowSec 讓視窗能快速 roll
      const detector = new HighlightDetector(
        makeConfig({ windowSec: 1, intensityThreshold: 1.0 })
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // 第一批 snapshot：hype 分數低（約 0.1），塞進 prevWindowScores
      for (let i = 0; i < 3; i++) {
        detector.feed(makeSnapshot({
          timestamp: base + i * 200,
          dominant: 'hype',
          intensity: 0.2,
          messageCount: 3,
          scores: { hype: 0.1, funny: 0.05, sad: 0.05, angry: 0.05 },
        }));
      }

      // 等視窗 roll（timestamp 超過 windowSec）
      // 送一個讓 lastWindowRollTime 更新的 snapshot
      detector.feed(makeSnapshot({
        timestamp: base + 2000, // 超過 windowSec(1s)，觸發 rollWindow
        dominant: 'hype',
        intensity: 0.2,
        messageCount: 3,
        scores: { hype: 0.1, funny: 0.05, sad: 0.05, angry: 0.05 },
      }));

      // 清除前面可能觸發的事件
      listener.mockClear();

      // 現在送 hype 分數 0.1 + 0.35 = 0.45 的 snapshot
      // delta = 0.45 - 0.1 = 0.35 > 0.3 → 觸發
      // 注意：hype 的冷卻可能已被觸發，改用 sad
      detector.feed(makeSnapshot({
        timestamp: base + 3000,
        dominant: 'sad',
        intensity: 0.2,
        messageCount: 3,
        scores: { hype: 0.05, funny: 0.05, sad: 0.45, angry: 0.05 },
      }));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('neutral 情緒的 delta 不觸發', () => {
      const detector = new HighlightDetector(
        makeConfig({ windowSec: 1, intensityThreshold: 1.0 })
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // 建立 prevWindowScores
      for (let i = 0; i < 3; i++) {
        detector.feed(makeSnapshot({
          timestamp: base + i * 200,
          dominant: 'neutral',
          intensity: 0.1,
          messageCount: 1,
          scores: { hype: 0.0, funny: 0.0, sad: 0.0, angry: 0.0 },
        }));
      }

      // Roll window
      detector.feed(makeSnapshot({
        timestamp: base + 2000,
        dominant: 'neutral',
        intensity: 0.1,
        messageCount: 1,
        scores: { hype: 0.0, funny: 0.0, sad: 0.0, angry: 0.0 },
      }));

      listener.mockClear();

      // 送高 neutral snapshot，delta 應不觸發（neutral 被排除）
      detector.feed(makeSnapshot({
        timestamp: base + 3000,
        dominant: 'neutral',
        intensity: 0.1,
        messageCount: 1,
        scores: { hype: 0.0, funny: 0.0, sad: 0.0, angry: 0.0 },
      }));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── 冷卻機制 ─────────────────────────────────────────────────

  describe('冷卻機制', () => {
    it('同類情緒在 cooldownSec 內不重複觸發', () => {
      // cooldownSec 設很長（300s），確保第二次不觸發
      const detector = new HighlightDetector(
        makeConfig({ intensityThreshold: 0.8, cooldownSec: 300 })
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // 第一次觸發
      detector.feed(makeSnapshot({ timestamp: base, dominant: 'hype', intensity: 0.9 }));
      expect(listener).toHaveBeenCalledTimes(1);

      // 立即再送，同情緒、冷卻未過
      detector.feed(makeSnapshot({ timestamp: base + 1000, dominant: 'hype', intensity: 0.95 }));
      expect(listener).toHaveBeenCalledTimes(1); // 不應新增觸發
    });

    it('冷卻結束後可以再次觸發同類情緒', () => {
      // cooldownSec 設 1s（方便用 timestamp 模擬）
      const detector = new HighlightDetector(
        makeConfig({ intensityThreshold: 0.8, cooldownSec: 1 })
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // 第一次觸發
      detector.feed(makeSnapshot({ timestamp: base, dominant: 'hype', intensity: 0.9 }));
      expect(listener).toHaveBeenCalledTimes(1);

      // 冷卻 1s 過後（timestamp + 1001ms）再次觸發
      detector.feed(makeSnapshot({
        timestamp: base + 1001,
        dominant: 'hype',
        intensity: 0.9,
      }));
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('不同情緒類型的冷卻互相獨立', () => {
      const detector = new HighlightDetector(
        makeConfig({ intensityThreshold: 0.8, cooldownSec: 300 })
      );
      const listener = vi.fn();
      detector.on('highlight', listener);

      const base = Date.now();

      // hype 觸發
      detector.feed(makeSnapshot({ timestamp: base, dominant: 'hype', intensity: 0.9 }));
      // funny 觸發（冷卻與 hype 獨立）
      detector.feed(makeSnapshot({
        timestamp: base + 500,
        dominant: 'funny',
        intensity: 0.9,
        scores: { hype: 0.1, funny: 0.9, sad: 0.0, angry: 0.0 },
      }));

      // 兩者都應觸發
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  // ── HighlightMarker 結構 ─────────────────────────────────────

  describe('HighlightMarker 結構', () => {
    it('emit 的 marker 包含正確欄位', () => {
      const detector = new HighlightDetector(
        makeConfig({ intensityThreshold: 0.8, windowSec: 30 })
      );
      let capturedMarker: unknown = null;
      detector.on('highlight', (marker) => { capturedMarker = marker; });

      const ts = Date.now();
      detector.feed(makeSnapshot({
        timestamp: ts,
        dominant: 'hype',
        intensity: 0.9,
        messageCount: 5,
      }));

      expect(capturedMarker).not.toBeNull();
      const marker = capturedMarker as {
        timestamp: number;
        emotion: string;
        intensity: number;
        duration: number;
        sampleMessages: string[];
      };

      // 欄位存在性驗證
      expect(marker).toHaveProperty('timestamp');
      expect(marker).toHaveProperty('emotion');
      expect(marker).toHaveProperty('intensity');
      expect(marker).toHaveProperty('duration');
      expect(marker).toHaveProperty('sampleMessages');

      // 值正確性驗證
      expect(marker.timestamp).toBe(ts);
      expect(marker.emotion).toBe('hype');
      expect(marker.intensity).toBeCloseTo(0.9);
      expect(marker.duration).toBe(30 * 1000); // windowSec * 1000
      expect(Array.isArray(marker.sampleMessages)).toBe(true);
    });

    it('sampleMessages 是字串陣列', () => {
      const detector = new HighlightDetector(makeConfig({ intensityThreshold: 0.8 }));
      let capturedMarker: { sampleMessages: unknown } | null = null;
      detector.on('highlight', (m) => { capturedMarker = m; });

      detector.feed(makeSnapshot({ intensity: 0.9 }));
      expect(Array.isArray(capturedMarker!.sampleMessages)).toBe(true);
      if (Array.isArray(capturedMarker!.sampleMessages)) {
        for (const msg of capturedMarker!.sampleMessages) {
          expect(typeof msg).toBe('string');
        }
      }
    });
  });
});
