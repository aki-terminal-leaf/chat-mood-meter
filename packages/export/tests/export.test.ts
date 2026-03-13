/**
 * export.test.ts — @cmm/export 單元測試
 *
 * 測試 exportJSON / exportCSV / exportHTML / exportEDL / exportChapters / exportSRT
 * 所有函式接受 ExportOptions，回傳字串，不寫入磁碟。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { EmotionSnapshot, HighlightMarker } from '@cmm/core';
import {
  exportJSON,
  exportCSV,
  exportHTML,
  exportEDL,
  exportChapters,
  exportSRT,
  type ExportOptions,
} from '../src/index.js';

// ─── 工具函式 ────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<EmotionSnapshot>): EmotionSnapshot {
  return {
    timestamp: Date.now(),
    dominant: 'hype',
    scores: { hype: 0.7, funny: 0.1, sad: 0.05, angry: 0.05 },
    intensity: 0.7,
    messageCount: 10,
    ...overrides,
  };
}

function makeHighlight(overrides?: Partial<HighlightMarker>): HighlightMarker {
  return {
    timestamp: Date.now(),
    emotion: 'hype',
    intensity: 0.85,
    duration: 30_000,
    sampleMessages: ['sample msg A', 'sample msg B'],
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('@cmm/export', () => {
  const base = Date.now() - 10_000;
  let opts: ExportOptions;

  beforeEach(() => {
    opts = {
      sessionId: 'test-session-2026',
      streamStartedAt: base,
      snapshots: [
        makeSnapshot({ timestamp: base,        dominant: 'hype',  intensity: 0.6, messageCount: 8  }),
        makeSnapshot({ timestamp: base + 1000, dominant: 'hype',  intensity: 0.8, messageCount: 12 }),
        makeSnapshot({ timestamp: base + 2000, dominant: 'funny', intensity: 0.5, messageCount: 6  }),
      ],
      highlights: [
        makeHighlight({ timestamp: base + 1000, emotion: 'hype',  intensity: 0.92, sampleMessages: ['chat exploded'] }),
        makeHighlight({ timestamp: base + 5000, emotion: 'funny', intensity: 0.85, sampleMessages: ['dying of laughter'] }),
      ],
    };
  });

  // ── exportJSON() ─────────────────────────────────────────────

  describe('exportJSON()', () => {
    it('回傳有效 JSON（可解析）', () => {
      const result = exportJSON(opts);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('包含 session、snapshots、highlights、summary 欄位', () => {
      const data = JSON.parse(exportJSON(opts));
      expect(data).toHaveProperty('session');
      expect(data).toHaveProperty('snapshots');
      expect(data).toHaveProperty('highlights');
      expect(data).toHaveProperty('summary');
    });

    it('snapshots 數量正確', () => {
      const data = JSON.parse(exportJSON(opts));
      expect(data.snapshots).toHaveLength(3);
    });

    it('highlights 數量正確', () => {
      const data = JSON.parse(exportJSON(opts));
      expect(data.highlights).toHaveLength(2);
    });

    it('session.id 包含 sessionId', () => {
      const data = JSON.parse(exportJSON(opts));
      expect(data.session.id).toBe('test-session-2026');
    });

    it('summary.peakEmotion 為 hype（多數快照）', () => {
      const data = JSON.parse(exportJSON(opts));
      expect(data.summary.peakEmotion).toBe('hype');
    });

    it('selectedHighlightIds 可篩選 highlights', () => {
      const result = exportJSON({ ...opts, selectedHighlightIds: [] });
      const data = JSON.parse(result);
      expect(data.highlights).toHaveLength(0);
    });

    it('無快照時 summary.totalMessages 為 0', () => {
      const result = exportJSON({ ...opts, snapshots: [] });
      const data = JSON.parse(result);
      expect(data.summary.totalMessages).toBe(0);
    });
  });

  // ── exportCSV() ──────────────────────────────────────────────

  describe('exportCSV()', () => {
    it('回傳字串（不拋錯）', () => {
      expect(() => exportCSV(opts)).not.toThrow();
    });

    it('第一行（去 BOM 後）是正確的 header', () => {
      const result = exportCSV(opts).replace(/^\uFEFF/, '');
      const lines = result.split('\n');
      const expectedHeader = 'timestamp,datetime,dominant,hype,funny,sad,angry,intensity,messageCount';
      expect(lines[0]).toBe(expectedHeader);
    });

    it('資料行數 = snapshot 數量', () => {
      const result = exportCSV(opts).replace(/^\uFEFF/, '');
      const lines = result.split('\n').filter(l => l.trim() !== '');
      // 1 header + 3 snapshots
      expect(lines.length).toBe(4);
    });

    it('資料行的欄位數量為 9', () => {
      const result = exportCSV(opts).replace(/^\uFEFF/, '');
      const lines = result.split('\n').filter(l => l.trim() !== '');
      const cols = lines[1].split(',');
      expect(cols.length).toBe(9);
    });

    it('含 BOM（Excel UTF-8 標記）', () => {
      const result = exportCSV(opts);
      expect(result.charCodeAt(0)).toBe(0xFEFF);
    });

    it('無快照時只有 header', () => {
      const result = exportCSV({ ...opts, snapshots: [] }).replace(/^\uFEFF/, '');
      const lines = result.split('\n').filter(l => l.trim() !== '');
      expect(lines.length).toBe(1);
    });
  });

  // ── exportHTML() ─────────────────────────────────────────────

  describe('exportHTML()', () => {
    it('回傳字串（不拋錯）', () => {
      expect(() => exportHTML(opts)).not.toThrow();
    });

    it('包含 <!DOCTYPE html>', () => {
      expect(exportHTML(opts)).toContain('<!DOCTYPE html>');
    });

    it('包含 Chart.js CDN 引用', () => {
      expect(exportHTML(opts)).toContain('chart.js');
    });

    it('包含 <canvas> 元素（用於圖表）', () => {
      expect(exportHTML(opts)).toContain('<canvas');
    });

    it('包含 Chat Mood Meter 識別字串', () => {
      expect(exportHTML(opts)).toContain('Chat Mood Meter');
    });

    it('包含 sessionId', () => {
      expect(exportHTML(opts)).toContain('test-session-2026');
    });

    it('無快照時仍可生成', () => {
      const result = exportHTML({ ...opts, snapshots: [] });
      expect(result).toContain('<!DOCTYPE html>');
    });
  });

  // ── exportEDL() ──────────────────────────────────────────────

  describe('exportEDL()', () => {
    it('有 TITLE 行', () => {
      const result = exportEDL(opts);
      expect(result).toContain('TITLE:');
    });

    it('有 FCM: NON-DROP FRAME', () => {
      const result = exportEDL(opts);
      expect(result).toContain('FCM: NON-DROP FRAME');
    });

    it('每個 highlight 對應一個 edit event（* HIGHLIGHT: 行數等於 highlights 數量）', () => {
      const result = exportEDL(opts);
      const count = (result.match(/\* HIGHLIGHT:/g) ?? []).length;
      expect(count).toBe(opts.highlights.length);
    });

    it('timecode 格式正確（HH:MM:SS:FF）', () => {
      const result = exportEDL(opts);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}:\d{2}/);
    });

    it('event 編號格式正確（001 開始）', () => {
      const result = exportEDL(opts);
      expect(result).toContain('001');
    });

    it('空 highlights → 只有 header，無 * HIGHLIGHT:', () => {
      const result = exportEDL({ ...opts, highlights: [] });
      expect(result).toContain('TITLE:');
      expect(result).toContain('FCM: NON-DROP FRAME');
      expect(result).not.toContain('* HIGHLIGHT:');
    });

    it('包含情緒名稱（大寫）', () => {
      const result = exportEDL(opts);
      expect(result).toContain('HYPE');
    });

    it('包含強度百分比', () => {
      const result = exportEDL(opts);
      expect(result).toMatch(/\d+%/);
    });
  });

  // ── exportChapters() ─────────────────────────────────────────

  describe('exportChapters()', () => {
    it('第一行是 00:00:00 Stream Start', () => {
      const result = exportChapters(opts);
      const firstLine = result.split('\n')[0];
      expect(firstLine).toBe('00:00:00 Stream Start');
    });

    it('有正確 emoji（hype → 🔥）', () => {
      const result = exportChapters(opts);
      expect(result).toContain('🔥');
    });

    it('funny highlight 有對應 emoji（😂）', () => {
      const result = exportChapters(opts);
      expect(result).toContain('😂');
    });

    it('有 offset 時間（HH:MM:SS 格式）', () => {
      const result = exportChapters(opts);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('行數 = 1（Stream Start）+ highlights 數量', () => {
      const result = exportChapters(opts);
      const lines = result.split('\n').filter(l => l.trim() !== '');
      expect(lines.length).toBe(1 + opts.highlights.length);
    });

    it('空 highlights → 只有第一行', () => {
      const result = exportChapters({ ...opts, highlights: [] });
      const lines = result.split('\n').filter(l => l.trim() !== '');
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('00:00:00 Stream Start');
    });
  });

  // ── exportSRT() ──────────────────────────────────────────────

  describe('exportSRT()', () => {
    it('有序號（第一個字幕的序號為 1）', () => {
      const result = exportSRT(opts);
      expect(result).toMatch(/^1\n/);
    });

    it('有 --> 時間範圍', () => {
      const result = exportSRT(opts);
      expect(result).toContain('-->');
    });

    it('時間格式為 HH:MM:SS,mmm', () => {
      const result = exportSRT(opts);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2},\d{3}/);
    });

    it('有 emoji + 情緒（hype → 🔥 HYPE）', () => {
      const result = exportSRT(opts);
      expect(result).toContain('🔥');
      expect(result).toContain('HYPE');
    });

    it('有強度百分比', () => {
      const result = exportSRT(opts);
      expect(result).toMatch(/\d+% intensity/);
    });

    it('包含 sampleMessages[0]', () => {
      const result = exportSRT(opts);
      expect(result).toContain('chat exploded');
    });

    it('字幕段落數等於 highlights 數量', () => {
      const result = exportSRT(opts);
      // SRT 序號以純數字行出現，抓 /^\d+$/m
      const seqMatches = result.match(/^\d+$/gm) ?? [];
      expect(seqMatches.length).toBe(opts.highlights.length);
    });

    it('空 highlights → 空字串', () => {
      const result = exportSRT({ ...opts, highlights: [] });
      expect(result).toBe('');
    });
  });
});
