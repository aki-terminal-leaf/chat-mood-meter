/**
 * analyzer-emote-map.test.ts
 * 測試 emote-map.ts 的資料完整性
 *
 * 確保映射表結構正確、覆蓋三大語系 + Unicode emoji，
 * 且所有數值都在合法範圍內（0-1）。
 */

import { describe, it, expect } from 'vitest';
import { EMOTE_MAP, KEYWORD_MAP } from '../src/analyzer/emote-map.js';
import type { EmoteEntry } from '../src/analyzer/emote-map.js';

// ─────────────────────────────────────────────
// EMOTE_MAP 基本結構測試
// ─────────────────────────────────────────────

describe('EMOTE_MAP 完整性', () => {
  // 取出所有 entries，後續各測試共用
  const entries = Object.entries(EMOTE_MAP) as [string, EmoteEntry][];

  it('至少應有 100 個條目', () => {
    expect(entries.length).toBeGreaterThanOrEqual(100);
  });

  it('每個 entry 的 scores 都必須包含 hype / funny / sad / angry 四個欄位', () => {
    for (const [key, entry] of entries) {
      const { scores } = entry;
      expect(scores, `${key} 缺少 scores.hype`).toHaveProperty('hype');
      expect(scores, `${key} 缺少 scores.funny`).toHaveProperty('funny');
      expect(scores, `${key} 缺少 scores.sad`).toHaveProperty('sad');
      expect(scores, `${key} 缺少 scores.angry`).toHaveProperty('angry');
    }
  });

  it('每個 entry 的 weight 都必須在 0-1 之間', () => {
    for (const [key, entry] of entries) {
      expect(entry.weight, `${key}.weight 超出範圍`).toBeGreaterThanOrEqual(0);
      expect(entry.weight, `${key}.weight 超出範圍`).toBeLessThanOrEqual(1);
    }
  });

  it('每個 entry 的 scores 值都必須在 0-1 之間', () => {
    for (const [key, entry] of entries) {
      const dims = ['hype', 'funny', 'sad', 'angry'] as const;
      for (const dim of dims) {
        const val = entry.scores[dim];
        expect(val, `${key}.scores.${dim} = ${val} 超出範圍`).toBeGreaterThanOrEqual(0);
        expect(val, `${key}.scores.${dim} = ${val} 超出範圍`).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─────────────────────────────────────────────
// 語系覆蓋測試
// ─────────────────────────────────────────────

describe('EMOTE_MAP 語系覆蓋', () => {
  it('應涵蓋歐美 Twitch emote：PogChamp', () => {
    expect(EMOTE_MAP).toHaveProperty('PogChamp');
  });

  it('應涵蓋歐美 Twitch emote：KEKW', () => {
    expect(EMOTE_MAP).toHaveProperty('KEKW');
  });

  it('應涵蓋歐美 Twitch emote：LUL', () => {
    expect(EMOTE_MAP).toHaveProperty('LUL');
  });

  it('應涵蓋台灣中文詞彙：笑死', () => {
    expect(EMOTE_MAP).toHaveProperty('笑死');
  });

  it('應涵蓋台灣中文詞彙：好耶', () => {
    expect(EMOTE_MAP).toHaveProperty('好耶');
  });

  it('應涵蓋台灣中文詞彙：QQ', () => {
    expect(EMOTE_MAP).toHaveProperty('QQ');
  });

  it('應涵蓋日文詞彙：草', () => {
    expect(EMOTE_MAP).toHaveProperty('草');
  });

  it('應涵蓋日文詞彙：ワロタ', () => {
    expect(EMOTE_MAP).toHaveProperty('ワロタ');
  });

  it('應涵蓋 Unicode emoji：😂', () => {
    expect(EMOTE_MAP).toHaveProperty('😂');
  });

  it('應涵蓋 Unicode emoji：😭', () => {
    expect(EMOTE_MAP).toHaveProperty('😭');
  });

  it('應涵蓋 Unicode emoji：🔥', () => {
    expect(EMOTE_MAP).toHaveProperty('🔥');
  });
});

// ─────────────────────────────────────────────
// 特定 emote 的分數語意驗證
// ─────────────────────────────────────────────

describe('EMOTE_MAP 分數語意', () => {
  it('PogChamp 的 hype 分數應最高（興奮型 emote）', () => {
    const { scores } = EMOTE_MAP['PogChamp'];
    expect(scores.hype).toBeGreaterThan(scores.funny);
    expect(scores.hype).toBeGreaterThan(scores.sad);
    expect(scores.hype).toBeGreaterThan(scores.angry);
  });

  it('KEKW 的 funny 分數應最高（搞笑型 emote）', () => {
    const { scores } = EMOTE_MAP['KEKW'];
    expect(scores.funny).toBeGreaterThan(scores.hype);
    expect(scores.funny).toBeGreaterThan(scores.sad);
    expect(scores.funny).toBeGreaterThan(scores.angry);
  });

  it('QQ 的 sad 分數應最高（悲傷型詞彙）', () => {
    const { scores } = EMOTE_MAP['QQ'];
    expect(scores.sad).toBeGreaterThan(scores.hype);
    expect(scores.sad).toBeGreaterThan(scores.funny);
    expect(scores.sad).toBeGreaterThan(scores.angry);
  });

  it('😡 的 angry 分數應最高（憤怒型 emoji）', () => {
    const { scores } = EMOTE_MAP['😡'];
    expect(scores.angry).toBeGreaterThan(scores.hype);
    expect(scores.angry).toBeGreaterThan(scores.funny);
    expect(scores.angry).toBeGreaterThan(scores.sad);
  });
});

// ─────────────────────────────────────────────
// KEYWORD_MAP 結構測試
// ─────────────────────────────────────────────

describe('KEYWORD_MAP 完整性', () => {
  it('KEYWORD_MAP 應為非空陣列', () => {
    expect(Array.isArray(KEYWORD_MAP)).toBe(true);
    expect(KEYWORD_MAP.length).toBeGreaterThan(0);
  });

  it('每個 KEYWORD_MAP 條目都應有 pattern 欄位', () => {
    for (const item of KEYWORD_MAP) {
      expect(item, '缺少 pattern 欄位').toHaveProperty('pattern');
    }
  });

  it('每個 KEYWORD_MAP 條目都應有 entry 欄位', () => {
    for (const item of KEYWORD_MAP) {
      expect(item, '缺少 entry 欄位').toHaveProperty('entry');
    }
  });

  it('每個 KEYWORD_MAP 條目的 pattern 都必須是 RegExp 實例', () => {
    for (const item of KEYWORD_MAP) {
      expect(item.pattern).toBeInstanceOf(RegExp);
    }
  });

  it('每個 KEYWORD_MAP 條目的 entry 結構必須符合 EmoteEntry 規格', () => {
    for (const item of KEYWORD_MAP) {
      const { entry } = item;
      // 確認有完整的 scores 欄位
      expect(entry).toHaveProperty('scores');
      expect(entry).toHaveProperty('weight');
      expect(entry.scores).toHaveProperty('hype');
      expect(entry.scores).toHaveProperty('funny');
      expect(entry.scores).toHaveProperty('sad');
      expect(entry.scores).toHaveProperty('angry');
    }
  });

  it('KEYWORD_MAP 的正則應能匹配哈哈哈（3+ 個哈）', () => {
    // 找到對應的 pattern
    const item = KEYWORD_MAP.find(k => k.pattern.toString().includes('哈'));
    expect(item).toBeDefined();
    expect(item!.pattern.test('哈哈哈')).toBe(true);
    // 只有兩個哈不應匹配（哈{3,}）
    expect(item!.pattern.test('哈哈')).toBe(false);
  });

  it('KEYWORD_MAP 的正則應能匹配 www（3+ 個 w）', () => {
    const item = KEYWORD_MAP.find(k => k.pattern.source.includes('w'));
    expect(item).toBeDefined();
    expect(item!.pattern.test('www')).toBe(true);
    expect(item!.pattern.test('wwwwwww')).toBe(true);
  });

  it('KEYWORD_MAP 的正則應能匹配 8888（3+ 個 8）', () => {
    const item = KEYWORD_MAP.find(k => k.pattern.source.includes('8'));
    expect(item).toBeDefined();
    expect(item!.pattern.test('8888')).toBe(true);
  });
});
