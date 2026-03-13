/**
 * server.ts — Dashboard HTTP 伺服器
 *
 * M7 模組：Dashboard Web UI
 * 提供 RESTful API 讓前端查詢歷史場次資料，
 * 並靜態服務 dashboard/public/ 目錄下的前端資源。
 *
 * 預設 port：9801（可透過 config.dashboard.port 設定）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Config, EmotionSnapshot, HighlightMarker } from '../types.js';

// ESM 環境中載入 CJS 模組
const require = createRequire(import.meta.url);

// 取得專案根目錄（src/dashboard/server.ts → 上兩層）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 預設 Dashboard port */
const DEFAULT_PORT = 9801;

/** 靜態資源目錄 */
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'dashboard', 'public');

/** MIME 類型對照表 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 情緒主題色（與 export.ts 一致） */
const EMOTION_COLOR: Record<string, string> = {
  hype:    '#f59e0b',
  funny:   '#10b981',
  sad:     '#60a5fa',
  angry:   '#f87171',
  neutral: '#94a3b8',
};

// ── better-sqlite3 型別宣告（最小化） ──────────────────────────

interface SqlStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
}

interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  close(): void;
}

// ── 資料庫回傳列型別 ────────────────────────────────────────────

interface SessionRow {
  session_id: string;
  started_at: number;
  ended_at: number | null;
  total_messages: number;
  total_highlights: number;
}

interface SnapshotRow {
  timestamp: number;
  dominant: string;
  hype: number;
  funny: number;
  sad: number;
  angry: number;
  intensity: number;
  message_count: number;
}

interface HighlightRow {
  timestamp: number;
  emotion: string;
  intensity: number;
  duration: number;
  sample_messages: string;
}

interface StatsRow {
  snapshot_count: number;
  peak_intensity: number | null;
  avg_intensity: number | null;
  avg_hype: number | null;
  avg_funny: number | null;
  avg_sad: number | null;
  avg_angry: number | null;
}

interface DominantRow {
  dominant: string;
  cnt: number;
}

// ── Config 擴充（支援 dashboard 區段） ───────────────────────────

interface DashboardConfig extends Config {
  dashboard?: {
    port?: number;
  };
}

// ── DashboardDB：唯讀資料庫封裝 ────────────────────────────────

/**
 * DashboardDB
 * 以唯讀模式開啟 SQLite，提供查詢方法供 API 使用。
 * 不繼承 SessionDB，避免不必要的寫入副作用。
 */
class DashboardDB {
  private db: SqlDatabase;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // 若資料庫檔案不存在，建立一個空的（schema 會在 SessionDB 初始化時建立）
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 以唯讀模式開啟，避免意外寫入
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Database = require('better-sqlite3') as new (p: string, opts?: Record<string, unknown>) => SqlDatabase;

    // 若 DB 不存在，readonly 會拋錯，改用一般模式開啟（僅初始化時）
    if (fs.existsSync(dbPath)) {
      this.db = new Database(dbPath, { readonly: true });
    } else {
      console.warn(`[Dashboard] 資料庫不存在：${dbPath}，建立空資料庫`);
      this.db = new Database(dbPath);
      // 建立基本 schema（讓查詢不會爆炸）
      (this.db as unknown as { exec: (s: string) => void }).exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY, started_at INTEGER,
          ended_at INTEGER, total_messages INTEGER DEFAULT 0, total_highlights INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, dominant TEXT NOT NULL,
          hype REAL, funny REAL, sad REAL, angry REAL,
          intensity REAL, message_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS highlights (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, emotion TEXT NOT NULL,
          intensity REAL, duration INTEGER, sample_messages TEXT
        );
      `);
    }

    console.log(`[Dashboard] 資料庫已連線：${dbPath}`);
  }

  /** 列出所有場次（最新在前） */
  listSessions(): SessionRow[] {
    return this.db.prepare(`
      SELECT session_id, started_at, ended_at, total_messages, total_highlights
      FROM sessions ORDER BY started_at DESC
    `).all() as SessionRow[];
  }

  /** 取得單場摘要（含統計） */
  getSessionSummary(sessionId: string): SessionRow & StatsRow & { dominant_emotion: string } | null {
    const session = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `).get(sessionId) as SessionRow | undefined;

    if (!session) return null;

    const stats = this.db.prepare(`
      SELECT
        COUNT(*)          as snapshot_count,
        MAX(intensity)    as peak_intensity,
        AVG(intensity)    as avg_intensity,
        AVG(hype)         as avg_hype,
        AVG(funny)        as avg_funny,
        AVG(sad)          as avg_sad,
        AVG(angry)        as avg_angry
      FROM snapshots WHERE session_id = ?
    `).get(sessionId) as StatsRow;

    const dominantRow = this.db.prepare(`
      SELECT dominant, COUNT(*) as cnt
      FROM snapshots WHERE session_id = ?
      GROUP BY dominant ORDER BY cnt DESC LIMIT 1
    `).get(sessionId) as DominantRow | undefined;

    return {
      ...session,
      ...stats,
      dominant_emotion: dominantRow?.dominant ?? 'neutral',
    };
  }

  /** 取得快照（支援時間範圍篩選） */
  getSnapshots(sessionId: string, from?: number, to?: number): EmotionSnapshot[] {
    // 依有無時間範圍選擇不同 SQL
    let rows: SnapshotRow[];

    if (from != null && to != null) {
      rows = this.db.prepare(`
        SELECT * FROM snapshots
        WHERE session_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `).all(sessionId, from, to) as SnapshotRow[];
    } else if (from != null) {
      rows = this.db.prepare(`
        SELECT * FROM snapshots
        WHERE session_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(sessionId, from) as SnapshotRow[];
    } else if (to != null) {
      rows = this.db.prepare(`
        SELECT * FROM snapshots
        WHERE session_id = ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `).all(sessionId, to) as SnapshotRow[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM snapshots WHERE session_id = ? ORDER BY timestamp ASC
      `).all(sessionId) as SnapshotRow[];
    }

    return rows.map(r => ({
      timestamp: r.timestamp,
      dominant: r.dominant as EmotionSnapshot['dominant'],
      scores: {
        hype:  r.hype  ?? 0,
        funny: r.funny ?? 0,
        sad:   r.sad   ?? 0,
        angry: r.angry ?? 0,
      },
      intensity:    r.intensity     ?? 0,
      messageCount: r.message_count ?? 0,
    }));
  }

  /** 取得高光標記 */
  getHighlights(sessionId: string): HighlightMarker[] {
    const rows = this.db.prepare(`
      SELECT * FROM highlights WHERE session_id = ? ORDER BY timestamp ASC
    `).all(sessionId) as HighlightRow[];

    return rows.map(r => ({
      timestamp: r.timestamp,
      emotion:   r.emotion as HighlightMarker['emotion'],
      intensity: r.intensity ?? 0,
      duration:  r.duration  ?? 0,
      sampleMessages: JSON.parse(r.sample_messages ?? '[]') as string[],
    }));
  }

  /** 跨場次統計 */
  getGlobalStats(): {
    totalSessions: number;
    totalDurationMs: number;
    avgEmotions: { hype: number; funny: number; sad: number; angry: number };
    mostActiveSessions: SessionRow[];
    emotionBreakdown: Record<string, number>;
    dailyActivity: { date: string; sessions: number; messages: number }[];
  } {
    // 場次總數
    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM sessions`).get() as { cnt: number };
    const totalSessions = countRow.cnt;

    // 總時長（只計算已結束的場次）
    const durRow = this.db.prepare(`
      SELECT COALESCE(SUM(ended_at - started_at), 0) as total
      FROM sessions WHERE ended_at IS NOT NULL
    `).get() as { total: number };

    // 全域平均情緒分布
    const emotionRow = this.db.prepare(`
      SELECT AVG(hype) as avg_hype, AVG(funny) as avg_funny,
             AVG(sad) as avg_sad, AVG(angry) as avg_angry
      FROM snapshots
    `).get() as { avg_hype: number | null; avg_funny: number | null; avg_sad: number | null; avg_angry: number | null };

    // 最活躍場次（按訊息數 Top 5）
    const mostActive = this.db.prepare(`
      SELECT session_id, started_at, ended_at, total_messages, total_highlights
      FROM sessions ORDER BY total_messages DESC LIMIT 5
    `).all() as SessionRow[];

    // 情緒出現分布（dominant 統計）
    const emotionBreakdownRows = this.db.prepare(`
      SELECT dominant, COUNT(*) as cnt FROM snapshots GROUP BY dominant
    `).all() as Array<{ dominant: string; cnt: number }>;

    const emotionBreakdown: Record<string, number> = {};
    for (const row of emotionBreakdownRows) {
      emotionBreakdown[row.dominant] = row.cnt;
    }

    // 每日活躍度（供熱力圖使用）
    const dailyRows = this.db.prepare(`
      SELECT
        DATE(started_at / 1000, 'unixepoch') as date,
        COUNT(*) as sessions,
        SUM(total_messages) as messages
      FROM sessions
      GROUP BY date
      ORDER BY date ASC
    `).all() as Array<{ date: string; sessions: number; messages: number }>;

    return {
      totalSessions,
      totalDurationMs: durRow.total,
      avgEmotions: {
        hype:  emotionRow?.avg_hype  ?? 0,
        funny: emotionRow?.avg_funny ?? 0,
        sad:   emotionRow?.avg_sad   ?? 0,
        angry: emotionRow?.avg_angry ?? 0,
      },
      mostActiveSessions: mostActive,
      emotionBreakdown,
      dailyActivity: dailyRows,
    };
  }

  /** 關閉連線 */
  close(): void {
    this.db.close();
  }
}

// ── 導出輔助函數（內嵌，不依賴 ExportManager）─────────────────

/** 格式化時間戳 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', { hour12: false });
}

/** 格式化時長（毫秒 → h m s） */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** HTML 跳脫 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 將場次資料轉成 CSV 字串 */
function buildCSV(sessionId: string, snapshots: EmotionSnapshot[]): string {
  const header = 'timestamp,datetime,dominant,hype,funny,sad,angry,intensity,messageCount';
  const rows = snapshots.map(s =>
    [
      s.timestamp,
      new Date(s.timestamp).toISOString(),
      s.dominant,
      s.scores.hype.toFixed(3),
      s.scores.funny.toFixed(3),
      s.scores.sad.toFixed(3),
      s.scores.angry.toFixed(3),
      s.intensity.toFixed(3),
      s.messageCount,
    ].join(','),
  );
  return '\uFEFF' + [header, ...rows].join('\n'); // BOM for Excel
}

/** 生成獨立 HTML 報告 */
function buildExportHTML(
  summary: ReturnType<DashboardDB['getSessionSummary']>,
  snapshots: EmotionSnapshot[],
  highlights: HighlightMarker[],
): string {
  if (!summary) return '<html><body>Session not found</body></html>';

  const durationMs = (summary.ended_at ?? Date.now()) - summary.started_at;
  const startedStr = formatTime(summary.started_at);
  const endedStr   = summary.ended_at ? formatTime(summary.ended_at) : 'Live';
  const durationStr = formatDuration(durationMs);
  const dominantColor = EMOTION_COLOR[summary.dominant_emotion] ?? '#94a3b8';

  const chartData = JSON.stringify({
    labels:    snapshots.map(s => new Date(s.timestamp).toLocaleTimeString('zh-TW', { hour12: false })),
    hype:      snapshots.map(s => s.scores.hype),
    funny:     snapshots.map(s => s.scores.funny),
    sad:       snapshots.map(s => s.scores.sad),
    angry:     snapshots.map(s => s.scores.angry),
    intensity: snapshots.map(s => s.intensity),
  });

  const highlightListHTML = highlights.length === 0
    ? '<p style="color:#64748b;text-align:center;padding:24px;">No highlights in this session</p>'
    : highlights.map((h, i) => {
        const color = EMOTION_COLOR[h.emotion] ?? '#94a3b8';
        const msgs  = h.sampleMessages.slice(0, 3)
          .map(m => `<span style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid #2d3144;border-radius:6px;padding:2px 10px;font-size:12px;color:#cbd5e1;margin:2px;">${escapeHTML(m)}</span>`)
          .join('');
        return `
          <div style="background:#1a1d2e;border:1px solid #2d3144;border-left:3px solid ${color};border-radius:12px;padding:14px 16px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:11px;color:#64748b;">#${i + 1}</span>
              <span style="font-size:13px;font-weight:600;color:#f1f5f9;">${formatTime(h.timestamp)}</span>
              <span style="font-size:13px;font-weight:700;color:${color};">${h.emotion}</span>
              <span style="font-size:12px;color:#64748b;margin-left:auto;">intensity ${(h.intensity * 100).toFixed(0)}%</span>
              <span style="font-size:12px;color:#64748b;">${formatDuration(h.duration)}</span>
            </div>
            ${msgs ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${msgs}</div>` : ''}
          </div>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Session Report — ${startedStr}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f1117;color:#e2e8f0;font-family:'Segoe UI',sans-serif;padding:24px 16px 64px}
    .container{max-width:960px;margin:0 auto}
    h1{font-size:24px;font-weight:700;color:#f1f5f9;margin-bottom:4px}
    .sub{color:#64748b;font-size:13px;margin-bottom:28px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
    .card{background:#1a1d2e;border:1px solid #2d3144;border-radius:12px;padding:16px}
    .card .label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
    .card .value{font-size:22px;font-weight:700;color:#f1f5f9;margin-top:4px}
    .chart-box{background:#1a1d2e;border:1px solid #2d3144;border-radius:12px;padding:20px;margin-bottom:28px}
    .section-title{font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px}
    .chart-wrap{position:relative;height:280px}
    footer{text-align:center;color:#475569;font-size:12px;margin-top:40px}
  </style>
</head>
<body><div class="container">
  <div style="text-align:center;margin-bottom:28px">
    <span style="display:inline-block;background:#818cf8;color:#fff;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 10px;border-radius:999px;margin-bottom:10px">Chat Mood Meter</span>
    <h1>Session Report</h1>
    <p class="sub">${startedStr} – ${endedStr} · ${durationStr}</p>
  </div>
  <div class="grid">
    <div class="card"><div class="label">Dominant Emotion</div><div class="value" style="color:${dominantColor}">${summary.dominant_emotion}</div></div>
    <div class="card"><div class="label">Avg Intensity</div><div class="value">${((summary.avg_intensity ?? 0) * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="label">Messages</div><div class="value">${summary.total_messages.toLocaleString()}</div></div>
    <div class="card"><div class="label">Highlights</div><div class="value">${summary.total_highlights}</div></div>
    <div class="card"><div class="label">Duration</div><div class="value">${durationStr}</div></div>
  </div>
  <div class="chart-box">
    <div class="section-title">📈 Emotion Timeline</div>
    <div class="chart-wrap"><canvas id="chart"></canvas></div>
  </div>
  <div>
    <div class="section-title">⚡ Highlights</div>
    ${highlightListHTML}
  </div>
  <footer>Generated by Chat Mood Meter · ${new Date().toLocaleString()}</footer>
</div>
<script>
const D = ${chartData};
if (D.labels.length > 0) {
  const ctx = document.getElementById('chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { labels: D.labels, datasets: [
      { label: 'Intensity', data: D.intensity, borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.08)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
      { label: 'Hype',  data: D.hype,  borderColor: '#f59e0b', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
      { label: 'Funny', data: D.funny, borderColor: '#10b981', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
      { label: 'Sad',   data: D.sad,   borderColor: '#60a5fa', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
      { label: 'Angry', data: D.angry, borderColor: '#f87171', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: { backgroundColor: '#1e2235', borderColor: '#2d3144', borderWidth: 1, callbacks: { label: c => ' '+c.dataset.label+': '+(c.parsed.y*100).toFixed(1)+'%' } }},
      scales: { x: { ticks: { color: '#475569', maxTicksLimit: 8 }, grid: { color: '#1e2235' } }, y: { min:0, max:1, ticks: { color: '#475569', callback: v=>(v*100).toFixed(0)+'%' }, grid: { color: '#1e2235' } } }
    }
  });
}
</script></body></html>`;
}

// ── DashboardServer 主類別 ────────────────────────────────────

/**
 * DashboardServer
 * 獨立的 HTTP 伺服器，提供 REST API + 靜態檔案服務。
 * 不依賴主程式的 WebSocket 伺服器，可單獨啟動。
 */
export class DashboardServer {
  private server: http.Server;
  private db: DashboardDB;
  private port: number;

  constructor(config: DashboardConfig) {
    // 從 config 取得 port，fallback 到預設值
    this.port = config.dashboard?.port ?? DEFAULT_PORT;

    // 解析資料庫路徑（支援相對路徑）
    const rawDbPath = config.storage?.dbPath ?? './data/sessions.db';
    const dbPath = path.isAbsolute(rawDbPath)
      ? rawDbPath
      : path.join(PROJECT_ROOT, rawDbPath);

    // 初始化唯讀資料庫
    this.db = new DashboardDB(dbPath);

    // 建立 HTTP server
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  /** 啟動伺服器 */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[Dashboard] ✅ Dashboard 已啟動：http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /** 停止伺服器 */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else {
          this.db.close();
          console.log('[Dashboard] 伺服器已停止');
          resolve();
        }
      });
    });
  }

  // ── 請求路由 ────────────────────────────────────────────────

  /** 請求分派：先嘗試 API 路由，再嘗試靜態檔案 */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url   = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const pathname = url.pathname;

    // 加入 CORS 標頭（允許所有來源，方便本地開發）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 處理 CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 只接受 GET
    if (req.method !== 'GET') {
      this.sendJSON(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    // API 路由
    if (pathname.startsWith('/api/')) {
      this.handleAPI(pathname, url, res);
      return;
    }

    // 靜態檔案
    this.serveStatic(pathname, res);
  }

  /**
   * API 路由分派
   * 匹配規則：逐一比對路徑 pattern
   */
  private handleAPI(
    pathname: string,
    url: URL,
    res: http.ServerResponse,
  ): void {
    try {
      // GET /api/sessions
      if (pathname === '/api/sessions') {
        const sessions = this.db.listSessions();
        this.sendJSON(res, 200, sessions.map(s => ({
          sessionId:       s.session_id,
          startedAt:       s.started_at,
          endedAt:         s.ended_at,
          totalMessages:   s.total_messages,
          totalHighlights: s.total_highlights,
          // 計算時長（ms）
          durationMs: s.ended_at ? s.ended_at - s.started_at : null,
        })));
        return;
      }

      // GET /api/stats
      if (pathname === '/api/stats') {
        const stats = this.db.getGlobalStats();
        this.sendJSON(res, 200, stats);
        return;
      }

      // 以 /api/sessions/:id 開頭的路由
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
      if (sessionMatch) {
        const sessionId   = decodeURIComponent(sessionMatch[1]);
        const subPath     = sessionMatch[2] ?? '';

        // GET /api/sessions/:id
        if (subPath === '' || subPath === '/') {
          const summary = this.db.getSessionSummary(sessionId);
          if (!summary) {
            this.sendJSON(res, 404, { error: 'Session not found' });
            return;
          }
          // 整理輸出格式
          const durationMs = (summary.ended_at ?? Date.now()) - summary.started_at;
          this.sendJSON(res, 200, {
            sessionId:       summary.session_id,
            startedAt:       summary.started_at,
            endedAt:         summary.ended_at,
            totalMessages:   summary.total_messages,
            totalHighlights: summary.total_highlights,
            snapshotCount:   summary.snapshot_count,
            peakIntensity:   summary.peak_intensity ?? 0,
            avgIntensity:    summary.avg_intensity  ?? 0,
            dominantEmotion: summary.dominant_emotion,
            durationMs,
            avgEmotions: {
              hype:  summary.avg_hype  ?? 0,
              funny: summary.avg_funny ?? 0,
              sad:   summary.avg_sad   ?? 0,
              angry: summary.avg_angry ?? 0,
            },
          });
          return;
        }

        // GET /api/sessions/:id/snapshots?from=&to=
        if (subPath === '/snapshots') {
          const fromStr = url.searchParams.get('from');
          const toStr   = url.searchParams.get('to');
          const from = fromStr ? parseInt(fromStr, 10) : undefined;
          const to   = toStr   ? parseInt(toStr,   10) : undefined;

          // 先確認場次存在
          if (!this.db.getSessionSummary(sessionId)) {
            this.sendJSON(res, 404, { error: 'Session not found' });
            return;
          }

          const snapshots = this.db.getSnapshots(sessionId, from, to);
          this.sendJSON(res, 200, snapshots);
          return;
        }

        // GET /api/sessions/:id/highlights
        if (subPath === '/highlights') {
          if (!this.db.getSessionSummary(sessionId)) {
            this.sendJSON(res, 404, { error: 'Session not found' });
            return;
          }
          const highlights = this.db.getHighlights(sessionId);
          this.sendJSON(res, 200, highlights);
          return;
        }

        // GET /api/sessions/:id/export/:format
        const exportMatch = subPath.match(/^\/export\/(json|csv|html)$/);
        if (exportMatch) {
          const format = exportMatch[1];
          const summary = this.db.getSessionSummary(sessionId);
          if (!summary) {
            this.sendJSON(res, 404, { error: 'Session not found' });
            return;
          }

          const snapshots  = this.db.getSnapshots(sessionId);
          const highlights = this.db.getHighlights(sessionId);
          const safeId     = sessionId.replace(/[:.]/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '_');

          if (format === 'json') {
            // JSON 導出：完整資料
            const durationMs = (summary.ended_at ?? Date.now()) - summary.started_at;
            const payload = {
              session: {
                id:      sessionId,
                started: new Date(summary.started_at).toISOString(),
                ended:   summary.ended_at ? new Date(summary.ended_at).toISOString() : null,
              },
              snapshots,
              highlights,
              summary: {
                peakEmotion:      summary.dominant_emotion,
                peakIntensity:    summary.peak_intensity   ?? 0,
                avgIntensity:     summary.avg_intensity    ?? 0,
                totalMessages:    summary.total_messages,
                totalHighlights:  summary.total_highlights,
                durationMinutes:  Math.round(durationMs / 60000),
              },
            };
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="session-${safeId}.json"`);
            res.writeHead(200);
            res.end(JSON.stringify(payload, null, 2));

          } else if (format === 'csv') {
            // CSV 導出：快照時序資料
            const csv = buildCSV(sessionId, snapshots);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="session-${safeId}.csv"`);
            res.writeHead(200);
            res.end(csv);

          } else if (format === 'html') {
            // HTML 導出：獨立報告頁面
            const html = buildExportHTML(summary, snapshots, highlights);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="session-${safeId}.html"`);
            res.writeHead(200);
            res.end(html);
          }
          return;
        }
      }

      // 找不到路由
      this.sendJSON(res, 404, { error: 'API endpoint not found' });

    } catch (err) {
      // 錯誤處理：避免伺服器因未捕獲例外崩潰
      console.error('[Dashboard] API 錯誤：', err);
      this.sendJSON(res, 500, { error: 'Internal server error' });
    }
  }

  /**
   * 靜態檔案服務
   * 從 dashboard/public/ 目錄服務前端資源。
   * 路徑 "/" 自動導向 index.html。
   */
  private serveStatic(pathname: string, res: http.ServerResponse): void {
    // 防止目錄遍歷攻擊
    const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');

    // 根路徑指向 index.html
    const filePath = pathname === '/'
      ? path.join(PUBLIC_DIR, 'index.html')
      : path.join(PUBLIC_DIR, safePath);

    // 確保路徑在 PUBLIC_DIR 內
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // 找不到檔案時，嘗試回傳 index.html（SPA fallback）
          fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexData) => {
            if (err2) {
              res.writeHead(404);
              res.end('Not Found');
            } else {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.writeHead(200);
              res.end(indexData);
            }
          });
        } else {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
        return;
      }

      // 根據副檔名設定 Content-Type
      const ext  = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.writeHead(200);
      res.end(data);
    });
  }

  /** 回傳 JSON 回應 */
  private sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }
}
