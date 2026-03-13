/**
 * storage-export.test.ts
 * 測試 ExportManager：JSON / CSV / HTML 格式導出。
 *
 * 注意：ExportManager 的導出目錄硬編碼為 {PROJECT_ROOT}/data/exports/，
 * 因此測試結束後需清除產生的檔案。
 * SessionDB 使用臨時目錄。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionDB } from '../src/storage/db.js';
import { ExportManager } from '../src/storage/export.js';
import type { EmotionSnapshot, HighlightMarker } from '../src/types.js';

// ─── 工具函式 ────────────────────────────────────────────────

/**
 * 建立測試用 EmotionSnapshot
 */
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

/**
 * 建立測試用 HighlightMarker
 */
function makeHighlight(overrides?: Partial<HighlightMarker>): HighlightMarker {
  return {
    timestamp: Date.now(),
    emotion: 'hype',
    intensity: 0.85,
    duration: 30_000,
    sampleMessages: ['[2026-03-13T10:00:00.000Z] dominant=hype intensity=0.85 msgs=15'],
    ...overrides,
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('ExportManager', () => {
  // 每個測試獨立的 DB（臨時目錄）
  let tmpDir: string;
  let dbPath: string;
  let db: SessionDB;
  let exporter: ExportManager;
  let sessionId: string;
  /** 追蹤測試產生的導出檔案，afterEach 清理 */
  const createdFiles: string[] = [];

  beforeEach(() => {
    // 建立臨時 DB
    tmpDir = mkdtempSync(join(tmpdir(), 'cmm-export-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new SessionDB(dbPath);
    exporter = new ExportManager(db);

    // 準備一筆完整的測試 session
    db.startSession();
    sessionId = db.getSessionId();

    const base = Date.now() - 10_000;
    db.saveSnapshot(makeSnapshot({ timestamp: base,        dominant: 'hype',  intensity: 0.6, messageCount: 8  }));
    db.saveSnapshot(makeSnapshot({ timestamp: base + 1000, dominant: 'hype',  intensity: 0.8, messageCount: 12 }));
    db.saveSnapshot(makeSnapshot({ timestamp: base + 2000, dominant: 'funny', intensity: 0.5, messageCount: 6  }));

    db.saveHighlight(makeHighlight({
      timestamp: base + 1000,
      emotion: 'hype',
      intensity: 0.8,
      sampleMessages: ['sample msg A', 'sample msg B'],
    }));

    db.endSession();
  });

  afterEach(() => {
    // 關閉 DB
    try { db.close(); } catch { /* 忽略 */ }
    // 清除臨時 DB 目錄
    rmSync(tmpDir, { recursive: true, force: true });
    // 清除導出檔案
    for (const f of createdFiles) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* 忽略 */ }
    }
    createdFiles.length = 0;
  });

  // ── exportJSON() ─────────────────────────────────────────────

  describe('exportJSON()', () => {
    it('回傳的檔案路徑存在', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      expect(existsSync(outputPath)).toBe(true);
    });

    it('產生有效 JSON（可解析）', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      const raw = readFileSync(outputPath, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('JSON 包含 session、snapshots、highlights、summary 欄位', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      const data = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(data).toHaveProperty('session');
      expect(data).toHaveProperty('snapshots');
      expect(data).toHaveProperty('highlights');
      expect(data).toHaveProperty('summary');
    });

    it('JSON 中的 snapshots 數量正確', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      const data = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(data.snapshots).toHaveLength(3);
    });

    it('JSON 中的 highlights 數量正確', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      const data = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(data.highlights).toHaveLength(1);
    });

    it('session ID 不存在時拋出錯誤', () => {
      expect(() => exporter.exportJSON('nonexistent-id')).toThrow('找不到 session');
    });

    it('導出路徑包含 session ID 相關字串（sanitized）', () => {
      const outputPath = exporter.exportJSON(sessionId);
      createdFiles.push(outputPath);

      // 檔名包含 "session-" 前綴
      const filename = outputPath.split('/').pop()!;
      expect(filename).toMatch(/^session-.+\.json$/);
    });
  });

  // ── exportCSV() ──────────────────────────────────────────────

  describe('exportCSV()', () => {
    it('回傳的檔案路徑存在', () => {
      const outputPath = exporter.exportCSV(sessionId);
      createdFiles.push(outputPath);

      expect(existsSync(outputPath)).toBe(true);
    });

    it('CSV 第一行是正確的 header', () => {
      const outputPath = exporter.exportCSV(sessionId);
      createdFiles.push(outputPath);

      // CSV 可能有 BOM（U+FEFF），需去除後解析
      const raw = readFileSync(outputPath, 'utf-8').replace(/^\uFEFF/, '');
      const lines = raw.split('\n');

      const expectedHeader = 'timestamp,datetime,dominant,hype,funny,sad,angry,intensity,messageCount';
      expect(lines[0]).toBe(expectedHeader);
    });

    it('CSV 行數 = 1(header) + snapshot 數量', () => {
      const outputPath = exporter.exportCSV(sessionId);
      createdFiles.push(outputPath);

      const raw = readFileSync(outputPath, 'utf-8').replace(/^\uFEFF/, '');
      const lines = raw.split('\n').filter(l => l.trim() !== '');

      // 1 header + 3 snapshots
      expect(lines.length).toBe(4);
    });

    it('CSV 資料行的欄位數量正確（9 欄）', () => {
      const outputPath = exporter.exportCSV(sessionId);
      createdFiles.push(outputPath);

      const raw = readFileSync(outputPath, 'utf-8').replace(/^\uFEFF/, '');
      const lines = raw.split('\n').filter(l => l.trim() !== '');

      // 跳過 header，檢查第一筆資料行
      const dataLine = lines[1];
      const cols = dataLine.split(',');
      expect(cols.length).toBe(9);
    });

    it('session ID 不存在時拋出錯誤', () => {
      expect(() => exporter.exportCSV('nonexistent-id')).toThrow('找不到 session');
    });

    it('導出路徑副檔名為 .csv', () => {
      const outputPath = exporter.exportCSV(sessionId);
      createdFiles.push(outputPath);

      expect(outputPath.endsWith('.csv')).toBe(true);
    });
  });

  // ── exportHTML() ─────────────────────────────────────────────

  describe('exportHTML()', () => {
    it('回傳的檔案路徑存在', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      expect(existsSync(outputPath)).toBe(true);
    });

    it('HTML 包含 <!DOCTYPE html>', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      const content = readFileSync(outputPath, 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
    });

    it('HTML 包含 Chart.js CDN 引用', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      const content = readFileSync(outputPath, 'utf-8');
      // 確認有引用 chart.js
      expect(content).toContain('chart.js');
    });

    it('HTML 包含 <canvas> 元素（用於圖表）', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      const content = readFileSync(outputPath, 'utf-8');
      expect(content).toContain('<canvas');
    });

    it('HTML 包含 Chat Mood Meter 識別字串', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      const content = readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Chat Mood Meter');
    });

    it('session ID 不存在時拋出錯誤', () => {
      expect(() => exporter.exportHTML('nonexistent-id')).toThrow('找不到 session');
    });

    it('導出路徑副檔名為 .html', () => {
      const outputPath = exporter.exportHTML(sessionId);
      createdFiles.push(outputPath);

      expect(outputPath.endsWith('.html')).toBe(true);
    });
  });

  // ── 導出路徑正確性 ────────────────────────────────────────────

  describe('導出路徑', () => {
    it('三種格式的導出路徑都在同一目錄', () => {
      const jsonPath = exporter.exportJSON(sessionId);
      const csvPath  = exporter.exportCSV(sessionId);
      const htmlPath = exporter.exportHTML(sessionId);
      createdFiles.push(jsonPath, csvPath, htmlPath);

      // 所有檔案應在同一目錄（exports/）
      const dir = (p: string) => p.substring(0, p.lastIndexOf('/'));
      expect(dir(jsonPath)).toBe(dir(csvPath));
      expect(dir(csvPath)).toBe(dir(htmlPath));
    });

    it('導出目錄路徑包含 data/exports', () => {
      const jsonPath = exporter.exportJSON(sessionId);
      createdFiles.push(jsonPath);

      expect(jsonPath).toContain('data/exports');
    });
  });
});
