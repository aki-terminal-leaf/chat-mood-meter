/**
 * Dashboard Server 測試
 * 測試 RESTful API 端點 + CORS
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionDB } from '../src/storage/db.js';

// 臨時目錄與 DB
const tmpDir = mkdtempSync(join(tmpdir(), 'cmm-dash-'));
const dbPath = join(tmpDir, 'test.db');

let db: SessionDB;
let server: any;
let sessionId: string;
let baseUrl: string;
const port = 19800 + Math.floor(Math.random() * 200);

// ── 建立測試資料 ──────────────────────────────────────────

function seedData() {
  db = new SessionDB(dbPath);
  db.startSession();
  sessionId = db.getSessionId();

  for (let i = 0; i < 10; i++) {
    db.saveSnapshot({
      timestamp: Date.now() - (10 - i) * 1000,
      dominant: i % 2 === 0 ? 'funny' : 'hype',
      scores: { hype: 0.3, funny: 0.5, sad: 0.1, angry: 0.1 },
      intensity: 0.6 + i * 0.03,
      messageCount: 5 + i,
    });
  }

  db.saveHighlight({
    timestamp: Date.now() - 5000,
    emotion: 'funny',
    intensity: 0.85,
    duration: 30000,
    sampleMessages: ['test msg 1', 'test msg 2'],
  });

  db.endSession();
  db.close();
}

// ── 設定 ─────────────────────────────────────────────────

beforeAll(async () => {
  seedData();

  const { DashboardServer } = await import('../src/dashboard/server.js');

  const config = {
    dashboard: { port },
    storage: { dbPath },
  };

  server = new DashboardServer(config as any);
  await server.start();
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  if (server) await server.stop();
});

// ── 測試 ─────────────────────────────────────────────────

describe('DashboardServer', () => {
  describe('GET /api/sessions', () => {
    it('回傳 JSON 陣列', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it('session 物件有必要欄位', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`);
      const data = await res.json();
      const s = data[0];
      // API 可能用 camelCase 或 snake_case
      const hasId = s.session_id || s.sessionId;
      const hasTime = s.started_at || s.startedAt;
      expect(hasId).toBeTruthy();
      expect(hasTime).toBeTruthy();
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('存在的 session 回傳 200', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId || data.session_id).toBeTruthy();
    });

    it('不存在的 session 回傳 404', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/nonexistent-id-12345`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/sessions/:id/snapshots', () => {
    it('回傳快照陣列', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/snapshots`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(10);
    });
  });

  describe('GET /api/sessions/:id/highlights', () => {
    it('回傳高光陣列', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/highlights`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
    });
  });

  describe('GET /api/stats', () => {
    it('回傳統計物件', async () => {
      const res = await fetch(`${baseUrl}/api/stats`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('totalSessions');
      expect(data.totalSessions).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CORS', () => {
    it('回應包含 Access-Control-Allow-Origin', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`);
      const acao = res.headers.get('access-control-allow-origin');
      expect(acao).toBe('*');
    });
  });

  describe('靜態檔案', () => {
    it('GET / 不回傳 500', async () => {
      const res = await fetch(baseUrl);
      expect(res.status).toBeLessThan(500);
    });
  });
});
