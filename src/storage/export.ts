/**
 * export.ts — 資料導出模組
 *
 * 支援三種格式：
 * - JSON：完整資料，供程式讀取
 * - CSV：快照時序資料，供 Excel 分析
 * - HTML：獨立報告頁面，含 Chart.js 視覺化，可直接分享
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionDB, SessionSummary } from './db.js';
import type { EmotionSnapshot, HighlightMarker } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 情緒中文名稱對照 */
const EMOTION_LABEL: Record<string, string> = {
  hype: '炒熱',
  funny: '好笑',
  sad: '悲傷',
  angry: '憤怒',
  neutral: '平靜',
};

/** 情緒主題色 */
const EMOTION_COLOR: Record<string, string> = {
  hype:    '#f59e0b',  // 琥珀橙
  funny:   '#10b981',  // 翠綠
  sad:     '#60a5fa',  // 天藍
  angry:   '#f87171',  // 珊瑚紅
  neutral: '#94a3b8',  // 石板灰
};

/** JSON 導出結構 */
interface ExportJSON {
  session: {
    id: string;
    started: string;
    ended: string | null;
  };
  snapshots: EmotionSnapshot[];
  highlights: HighlightMarker[];
  summary: {
    peakEmotion: string;
    peakIntensity: number;
    avgIntensity: number;
    totalMessages: number;
    totalHighlights: number;
    durationMinutes: number;
  };
}

/**
 * ExportManager
 * 從 SessionDB 讀取資料，導出為 JSON / CSV / HTML 格式。
 * 所有檔案存到 data/exports/ 目錄。
 */
export class ExportManager {
  private db: SessionDB;
  private exportDir: string;

  constructor(db: SessionDB) {
    this.db = db;
    this.exportDir = path.join(PROJECT_ROOT, 'data', 'exports');

    // 自動建立導出目錄
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
      console.log(`[Export] 建立導出目錄：${this.exportDir}`);
    }
  }

  /**
   * exportJSON
   * 將 session 完整資料導出為 JSON 檔。
   * 回傳導出檔案的絕對路徑。
   */
  exportJSON(sessionId: string): string {
    const summary = this.db.getSessionSummary(sessionId);
    if (!summary) throw new Error(`找不到 session：${sessionId}`);

    const snapshots = this.db.getSnapshots(sessionId);
    const highlights = this.db.getHighlights(sessionId);

    // 計算直播時長（分鐘）
    const durationMs = (summary.endedAt ?? Date.now()) - summary.startedAt;
    const durationMinutes = Math.round(durationMs / 60000);

    const data: ExportJSON = {
      session: {
        id: sessionId,
        started: new Date(summary.startedAt).toISOString(),
        ended: summary.endedAt ? new Date(summary.endedAt).toISOString() : null,
      },
      snapshots,
      highlights,
      summary: {
        peakEmotion: summary.dominantEmotion,
        peakIntensity: summary.peakIntensity,
        avgIntensity: summary.avgIntensity,
        totalMessages: summary.totalMessages,
        totalHighlights: summary.totalHighlights,
        durationMinutes,
      },
    };

    const filename = `session-${this.sanitizeFilename(sessionId)}.json`;
    const outputPath = path.join(this.exportDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`[Export] JSON 導出完成：${outputPath}`);
    return outputPath;
  }

  /**
   * exportCSV
   * 將快照資料導出為 CSV 格式（方便 Excel 分析）。
   * 欄位：timestamp, datetime, dominant, hype, funny, sad, angry, intensity, messageCount
   */
  exportCSV(sessionId: string): string {
    const summary = this.db.getSessionSummary(sessionId);
    if (!summary) throw new Error(`找不到 session：${sessionId}`);

    const snapshots = this.db.getSnapshots(sessionId);

    // CSV 標頭
    const header = 'timestamp,datetime,dominant,hype,funny,sad,angry,intensity,messageCount';

    // 每行資料
    const rows = snapshots.map(s => {
      const dt = new Date(s.timestamp).toISOString();
      return [
        s.timestamp,
        dt,
        s.dominant,
        s.scores.hype.toFixed(3),
        s.scores.funny.toFixed(3),
        s.scores.sad.toFixed(3),
        s.scores.angry.toFixed(3),
        s.intensity.toFixed(3),
        s.messageCount,
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');

    const filename = `session-${this.sanitizeFilename(sessionId)}.csv`;
    const outputPath = path.join(this.exportDir, filename);
    fs.writeFileSync(outputPath, '\uFEFF' + csv, 'utf-8'); // 加 BOM，讓 Excel 正確識別 UTF-8

    console.log(`[Export] CSV 導出完成：${outputPath}（${rows.length} 筆快照）`);
    return outputPath;
  }

  /**
   * exportHTML
   * 生成獨立 HTML 報告頁面。
   * 包含 Chart.js 情緒時間軸、高光標記、摘要卡片。
   * 深色主題，自包含，單一檔案可直接分享。
   */
  exportHTML(sessionId: string): string {
    const summary = this.db.getSessionSummary(sessionId);
    if (!summary) throw new Error(`找不到 session：${sessionId}`);

    const snapshots = this.db.getSnapshots(sessionId);
    const highlights = this.db.getHighlights(sessionId);

    const html = this.buildHTML(summary, snapshots, highlights);

    const filename = `session-${this.sanitizeFilename(sessionId)}.html`;
    const outputPath = path.join(this.exportDir, filename);
    fs.writeFileSync(outputPath, html, 'utf-8');

    console.log(`[Export] HTML 報告導出完成：${outputPath}`);
    return outputPath;
  }

  // ──────────────────────────────────────────
  // 內部工具
  // ──────────────────────────────────────────

  /** 將 sessionId 轉為合法檔名（移除特殊字符） */
  private sanitizeFilename(sessionId: string): string {
    return sessionId.replace(/[:.]/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '_');
  }

  /** 格式化時間戳為可讀字串 */
  private formatTime(ts: number): string {
    return new Date(ts).toLocaleString('zh-TW', { hour12: false });
  }

  /** 格式化時長（毫秒 → 時:分:秒） */
  private formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /**
   * buildHTML
   * 組裝完整的 HTML 報告，資料內嵌在 <script> 中。
   */
  private buildHTML(
    summary: SessionSummary,
    snapshots: EmotionSnapshot[],
    highlights: HighlightMarker[],
  ): string {
    const durationMs = (summary.endedAt ?? Date.now()) - summary.startedAt;
    const startedStr = this.formatTime(summary.startedAt);
    const endedStr = summary.endedAt ? this.formatTime(summary.endedAt) : '進行中';
    const durationStr = this.formatDuration(durationMs);
    const dominantLabel = EMOTION_LABEL[summary.dominantEmotion] ?? summary.dominantEmotion;
    const dominantColor = EMOTION_COLOR[summary.dominantEmotion] ?? '#94a3b8';

    // 將資料序列化供 Chart.js 使用
    const chartData = JSON.stringify({
      labels: snapshots.map(s => new Date(s.timestamp).toLocaleTimeString('zh-TW', { hour12: false })),
      hype:    snapshots.map(s => s.scores.hype),
      funny:   snapshots.map(s => s.scores.funny),
      sad:     snapshots.map(s => s.scores.sad),
      angry:   snapshots.map(s => s.scores.angry),
      intensity: snapshots.map(s => s.intensity),
    });

    const highlightsData = JSON.stringify(highlights.map(h => ({
      time: new Date(h.timestamp).toLocaleTimeString('zh-TW', { hour12: false }),
      timestamp: h.timestamp,
      emotion: h.emotion,
      emotionLabel: EMOTION_LABEL[h.emotion] ?? h.emotion,
      color: EMOTION_COLOR[h.emotion] ?? '#94a3b8',
      intensity: h.intensity,
      duration: this.formatDuration(h.duration),
      sampleMessages: h.sampleMessages,
    })));

    // 高光清單 HTML
    const highlightListHTML = highlights.length === 0
      ? '<p class="no-data">本場直播無高光時刻</p>'
      : highlights.map((h, i) => {
          const color = EMOTION_COLOR[h.emotion] ?? '#94a3b8';
          const label = EMOTION_LABEL[h.emotion] ?? h.emotion;
          const timeStr = this.formatTime(h.timestamp);
          const msgs = h.sampleMessages
            .slice(0, 3)
            .map(m => `<span class="sample-msg">${this.escapeHTML(m)}</span>`)
            .join('');
          return `
            <div class="highlight-card" style="border-left-color: ${color};">
              <div class="highlight-header">
                <span class="highlight-index">#${i + 1}</span>
                <span class="highlight-time">${timeStr}</span>
                <span class="highlight-emotion" style="color: ${color};">${label}</span>
                <span class="highlight-intensity">強度 ${(h.intensity * 100).toFixed(0)}%</span>
                <span class="highlight-duration">${this.formatDuration(h.duration)}</span>
              </div>
              ${msgs ? `<div class="highlight-messages">${msgs}</div>` : ''}
            </div>`;
        }).join('');

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Mood Meter — 直播報告 ${startedStr}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    /* ─── 全域設定 ─── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #0f1117;
      --surface:  #1a1d2e;
      --border:   #2d3144;
      --text:     #e2e8f0;
      --muted:    #64748b;
      --accent:   #818cf8;
      --radius:   12px;
      --c-hype:   #f59e0b;
      --c-funny:  #10b981;
      --c-sad:    #60a5fa;
      --c-angry:  #f87171;
      --c-neutral:#94a3b8;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Segoe UI', 'Noto Sans TC', sans-serif;
      font-size: 15px;
      line-height: 1.6;
      padding: 24px 16px 64px;
    }

    /* ─── 頁面容器 ─── */
    .container {
      max-width: 960px;
      margin: 0 auto;
    }

    /* ─── Header ─── */
    .page-header {
      text-align: center;
      margin-bottom: 32px;
    }
    .page-header .badge {
      display: inline-block;
      background: var(--accent);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 999px;
      margin-bottom: 10px;
    }
    .page-header h1 {
      font-size: 26px;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 4px;
    }
    .page-header .sub {
      color: var(--muted);
      font-size: 13px;
    }

    /* ─── 摘要卡片區 ─── */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-card .label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .stat-card .value {
      font-size: 22px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .stat-card .sub-value {
      font-size: 12px;
      color: var(--muted);
    }

    /* ─── 圖表區 ─── */
    .chart-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 16px;
    }
    .chart-wrapper {
      position: relative;
      height: 300px;
    }

    /* ─── 高光清單 ─── */
    .highlights-section {
      margin-bottom: 28px;
    }
    .highlight-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    .highlight-header {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .highlight-index {
      font-size: 11px;
      color: var(--muted);
      min-width: 24px;
    }
    .highlight-time {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      font-variant-numeric: tabular-nums;
    }
    .highlight-emotion {
      font-size: 13px;
      font-weight: 700;
    }
    .highlight-intensity, .highlight-duration {
      font-size: 12px;
      color: var(--muted);
      margin-left: auto;
    }
    .highlight-messages {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .sample-msg {
      display: inline-block;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px 10px;
      font-size: 12px;
      color: #cbd5e1;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .no-data {
      color: var(--muted);
      text-align: center;
      padding: 24px;
    }

    /* ─── Footer ─── */
    .footer {
      text-align: center;
      margin-top: 40px;
      color: var(--muted);
      font-size: 12px;
    }
    .footer a { color: var(--accent); text-decoration: none; }

    /* ─── 情緒圖例 ─── */
    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--muted);
    }
    .legend-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
<div class="container">

  <!-- ── Header ── -->
  <header class="page-header">
    <div class="badge">Chat Mood Meter</div>
    <h1>直播情緒報告</h1>
    <p class="sub">${startedStr} ～ ${endedStr}｜${durationStr}</p>
  </header>

  <!-- ── 摘要卡片 ── -->
  <div class="summary-grid">
    <div class="stat-card">
      <span class="label">主要情緒</span>
      <span class="value" style="color: ${dominantColor};">${dominantLabel}</span>
      <span class="sub-value">${summary.dominantEmotion}</span>
    </div>
    <div class="stat-card">
      <span class="label">平均強度</span>
      <span class="value">${(summary.avgIntensity * 100).toFixed(1)}%</span>
      <span class="sub-value">峰值 ${(summary.peakIntensity * 100).toFixed(1)}%</span>
    </div>
    <div class="stat-card">
      <span class="label">訊息總數</span>
      <span class="value">${summary.totalMessages.toLocaleString()}</span>
      <span class="sub-value">則聊天訊息</span>
    </div>
    <div class="stat-card">
      <span class="label">高光時刻</span>
      <span class="value">${summary.totalHighlights}</span>
      <span class="sub-value">個 highlight</span>
    </div>
    <div class="stat-card">
      <span class="label">分析快照</span>
      <span class="value">${summary.snapshotCount}</span>
      <span class="sub-value">個時間窗格</span>
    </div>
    <div class="stat-card">
      <span class="label">直播時長</span>
      <span class="value">${durationStr}</span>
      <span class="sub-value">${startedStr.split(' ')[0]}</span>
    </div>
  </div>

  <!-- ── 情緒時間軸圖表 ── -->
  <div class="chart-section">
    <div class="section-title">📈 情緒強度時間軸</div>
    <div class="chart-wrapper">
      <canvas id="moodChart"></canvas>
    </div>
    <div class="legend" id="chartLegend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--c-hype)"></div> 炒熱 (Hype)</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--c-funny)"></div> 好笑 (Funny)</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--c-sad)"></div> 悲傷 (Sad)</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--c-angry)"></div> 憤怒 (Angry)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#818cf8"></div> 整體強度</div>
    </div>
  </div>

  <!-- ── 高光清單 ── -->
  <div class="highlights-section">
    <div class="section-title">⚡ 高光時刻</div>
    ${highlightListHTML}
  </div>

  <footer class="footer">
    由 <strong>Chat Mood Meter</strong> 生成 · ${new Date().toLocaleString('zh-TW', { hour12: false })}
  </footer>
</div>

<script>
// 從資料庫導出的資料
const CHART_DATA = ${chartData};
const HIGHLIGHTS = ${highlightsData};

// 若無快照資料則不繪圖
if (CHART_DATA.labels.length === 0) {
  document.getElementById('moodChart').parentElement.innerHTML =
    '<p style="color:#64748b;text-align:center;padding:40px;">無快照資料</p>';
} else {
  // ── 計算高光標記在時間軸上的位置 ──
  const startTs = ${snapshots.length > 0 ? snapshots[0].timestamp : 0};
  const endTs   = ${snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : 1};
  const tRange  = endTs - startTs || 1;

  // 高光垂直線插件
  const highlightLinesPlugin = {
    id: 'highlightLines',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;

      HIGHLIGHTS.forEach(h => {
        // 計算 x 座標（依時間比例）
        const ratio = (h.timestamp - startTs) / tRange;
        const x = chartArea.left + ratio * (chartArea.right - chartArea.left);

        if (x < chartArea.left || x > chartArea.right) return;

        // 繪製垂直線
        ctx.save();
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();

        // 繪製標籤
        ctx.setLineDash([]);
        ctx.fillStyle = h.color;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚡' + h.emotionLabel, x, chartArea.top + 10);
        ctx.restore();
      });
    }
  };

  // 取樣：若快照超過 300 筆，按比例取樣避免圖表過密
  let labels = CHART_DATA.labels;
  let d = {
    hype: CHART_DATA.hype,
    funny: CHART_DATA.funny,
    sad: CHART_DATA.sad,
    angry: CHART_DATA.angry,
    intensity: CHART_DATA.intensity,
  };
  const MAX_POINTS = 300;
  if (labels.length > MAX_POINTS) {
    const step = Math.ceil(labels.length / MAX_POINTS);
    const sample = i => i % step === 0;
    labels   = labels.filter((_, i) => sample(i));
    d.hype   = d.hype.filter((_, i) => sample(i));
    d.funny  = d.funny.filter((_, i) => sample(i));
    d.sad    = d.sad.filter((_, i) => sample(i));
    d.angry  = d.angry.filter((_, i) => sample(i));
    d.intensity = d.intensity.filter((_, i) => sample(i));
  }

  const ctx = document.getElementById('moodChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '整體強度',
          data: d.intensity,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: '炒熱',
          data: d.hype,
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: '好笑',
          data: d.funny,
          borderColor: '#10b981',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: '悲傷',
          data: d.sad,
          borderColor: '#60a5fa',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: '憤怒',
          data: d.angry,
          borderColor: '#f87171',
          borderWidth: 1.5,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },  // 使用自訂圖例
        tooltip: {
          backgroundColor: '#1e2235',
          borderColor: '#2d3144',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          callbacks: {
            label: (ctx) => \` \${ctx.dataset.label}: \${(ctx.parsed.y * 100).toFixed(1)}%\`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#475569',
            maxTicksLimit: 8,
            maxRotation: 0,
          },
          grid: { color: '#1e2235' },
        },
        y: {
          min: 0, max: 1,
          ticks: {
            color: '#475569',
            callback: v => (v * 100).toFixed(0) + '%',
          },
          grid: { color: '#1e2235' },
        },
      },
    },
    plugins: [highlightLinesPlugin],
  });
}
</script>
</body>
</html>`;
  }

  /** HTML 跳脫，避免訊息內容造成 XSS */
  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
