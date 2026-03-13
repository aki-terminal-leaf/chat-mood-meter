/**
 * @cmm/export — 資料導出模組
 *
 * 支援格式：
 * - JSON：完整資料，供程式讀取
 * - CSV：快照時序資料，供 Excel 分析
 * - HTML：獨立報告頁面，含 Chart.js 視覺化，可直接分享
 * - EDL：影片剪輯決策清單（TODO M6）
 * - YouTube Chapters：YouTube 章節標記（TODO M6）
 * - SRT：字幕格式（TODO M6）
 */

import type { EmotionSnapshot, HighlightMarker } from '@cmm/core';

// ──────────────────────────────────────────
// 公開介面
// ──────────────────────────────────────────

/** 統一導出選項 */
export interface ExportOptions {
  sessionId: string;
  highlights: HighlightMarker[];
  snapshots?: EmotionSnapshot[];
  streamStartedAt: number;
  selectedHighlightIds?: number[];  // 可選擇性導出指定 highlight
}

// ──────────────────────────────────────────
// 內部常數
// ──────────────────────────────────────────

/** 情緒中文名稱對照 */
const EMOTION_LABEL: Record<string, string> = {
  hype:    '炒熱',
  funny:   '好笑',
  sad:     '悲傷',
  angry:   '憤怒',
  neutral: '平靜',
};

/** 情緒主題色 */
const EMOTION_COLOR: Record<string, string> = {
  hype:    '#f59e0b',
  funny:   '#10b981',
  sad:     '#60a5fa',
  angry:   '#f87171',
  neutral: '#94a3b8',
};

// ──────────────────────────────────────────
// 導出函式
// ──────────────────────────────────────────

/**
 * exportJSON
 * 將 session 完整資料序列化為 JSON 字串。
 */
export function exportJSON(opts: ExportOptions): string {
  const { sessionId, highlights, snapshots = [], streamStartedAt, selectedHighlightIds } = opts;

  const filteredHighlights = selectedHighlightIds
    ? highlights.filter((_, i) => selectedHighlightIds.includes(i))
    : highlights;

  const durationMs = Date.now() - streamStartedAt;
  const durationMinutes = Math.round(durationMs / 60000);

  // 統計摘要
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  const peakIntensity = snapshots.reduce((max, s) => Math.max(max, s.intensity), 0);
  const avgIntensity = snapshots.length > 0
    ? Math.round((snapshots.reduce((sum, s) => sum + s.intensity, 0) / snapshots.length) * 1000) / 1000
    : 0;

  // 最常出現的情緒
  const emotionCount: Record<string, number> = {};
  for (const s of snapshots) {
    emotionCount[s.dominant] = (emotionCount[s.dominant] ?? 0) + 1;
  }
  const peakEmotion = Object.entries(emotionCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';

  const data = {
    session: {
      id: sessionId,
      started: new Date(streamStartedAt).toISOString(),
    },
    snapshots,
    highlights: filteredHighlights,
    summary: {
      peakEmotion,
      peakIntensity,
      avgIntensity,
      totalMessages,
      totalHighlights: filteredHighlights.length,
      durationMinutes,
    },
  };

  return JSON.stringify(data, null, 2);
}

/**
 * exportCSV
 * 將快照資料序列化為 CSV 字串。
 * 欄位：timestamp, datetime, dominant, hype, funny, sad, angry, intensity, messageCount
 * 含 BOM，讓 Excel 正確識別 UTF-8。
 */
export function exportCSV(opts: ExportOptions): string {
  const { snapshots = [] } = opts;

  const header = 'timestamp,datetime,dominant,hype,funny,sad,angry,intensity,messageCount';

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

  // 加 BOM（\uFEFF），讓 Excel 正確識別 UTF-8
  return '\uFEFF' + [header, ...rows].join('\n');
}

/**
 * exportEDL
 * 將高光時刻導出為 EDL（Edit Decision List）格式。
 * TODO M6 實作
 */
export function exportEDL(_opts: ExportOptions): string {
  // TODO M6：實作 EDL 導出
  // EDL 格式範例（CMX 3600）：
  //   TITLE: Chat Mood Meter Highlights
  //   001  AX  V  C  00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
  return '';
}

/**
 * exportChapters
 * 將高光時刻導出為 YouTube 章節標記格式。
 * TODO M6 實作
 */
export function exportChapters(_opts: ExportOptions): string {
  // TODO M6：實作 YouTube Chapters 導出
  // 格式範例：
  //   0:00 開場
  //   1:23 炒熱時刻
  //   5:10 好笑時刻
  return '';
}

/**
 * exportSRT
 * 將高光時刻導出為 SRT 字幕格式。
 * TODO M6 實作
 */
export function exportSRT(_opts: ExportOptions): string {
  // TODO M6：實作 SRT 字幕導出
  // SRT 格式範例：
  //   1
  //   00:00:01,000 --> 00:00:05,000
  //   [炒熱] 強度 85%
  return '';
}

/**
 * exportHTML
 * 生成獨立 HTML 報告頁面。
 * 包含 Chart.js 情緒時間軸、高光標記、摘要卡片。
 * 深色主題，自包含，單一檔案可直接分享。
 */
export function exportHTML(opts: ExportOptions): string {
  const { sessionId, highlights, snapshots = [], streamStartedAt, selectedHighlightIds } = opts;

  const filteredHighlights = selectedHighlightIds
    ? highlights.filter((_, i) => selectedHighlightIds.includes(i))
    : highlights;

  // 計算統計資訊
  const durationMs = Date.now() - streamStartedAt;
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  const peakIntensity = snapshots.reduce((max, s) => Math.max(max, s.intensity), 0);
  const avgIntensity = snapshots.length > 0
    ? snapshots.reduce((sum, s) => sum + s.intensity, 0) / snapshots.length
    : 0;

  // 最常出現的情緒
  const emotionCount: Record<string, number> = {};
  for (const s of snapshots) {
    emotionCount[s.dominant] = (emotionCount[s.dominant] ?? 0) + 1;
  }
  const dominantEmotion = Object.entries(emotionCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';

  const startedStr = formatTime(streamStartedAt);
  const durationStr = formatDuration(durationMs);
  const dominantLabel = EMOTION_LABEL[dominantEmotion] ?? dominantEmotion;
  const dominantColor = EMOTION_COLOR[dominantEmotion] ?? '#94a3b8';

  // Chart.js 用資料
  const chartData = JSON.stringify({
    labels:    snapshots.map(s => new Date(s.timestamp).toLocaleTimeString('zh-TW', { hour12: false })),
    hype:      snapshots.map(s => s.scores.hype),
    funny:     snapshots.map(s => s.scores.funny),
    sad:       snapshots.map(s => s.scores.sad),
    angry:     snapshots.map(s => s.scores.angry),
    intensity: snapshots.map(s => s.intensity),
  });

  const highlightsData = JSON.stringify(filteredHighlights.map(h => ({
    time:          new Date(h.timestamp).toLocaleTimeString('zh-TW', { hour12: false }),
    timestamp:     h.timestamp,
    emotion:       h.emotion,
    emotionLabel:  EMOTION_LABEL[h.emotion] ?? h.emotion,
    color:         EMOTION_COLOR[h.emotion] ?? '#94a3b8',
    intensity:     h.intensity,
    duration:      formatDuration(h.duration),
    sampleMessages: h.sampleMessages,
  })));

  // 高光清單 HTML
  const highlightListHTML = filteredHighlights.length === 0
    ? '<p class="no-data">本場直播無高光時刻</p>'
    : filteredHighlights.map((h, i) => {
        const color = EMOTION_COLOR[h.emotion] ?? '#94a3b8';
        const label = EMOTION_LABEL[h.emotion] ?? h.emotion;
        const timeStr = formatTime(h.timestamp);
        const msgs = h.sampleMessages
          .slice(0, 3)
          .map(m => `<span class="sample-msg">${escapeHTML(m)}</span>`)
          .join('');
        return `
          <div class="highlight-card" style="border-left-color: ${color};">
            <div class="highlight-header">
              <span class="highlight-index">#${i + 1}</span>
              <span class="highlight-time">${timeStr}</span>
              <span class="highlight-emotion" style="color: ${color};">${label}</span>
              <span class="highlight-intensity">強度 ${(h.intensity * 100).toFixed(0)}%</span>
              <span class="highlight-duration">${formatDuration(h.duration)}</span>
            </div>
            ${msgs ? `<div class="highlight-messages">${msgs}</div>` : ''}
          </div>`;
      }).join('');

  const startTs = snapshots.length > 0 ? snapshots[0].timestamp : 0;
  const endTs   = snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : 1;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Mood Meter — 直播報告 ${startedStr}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:       #0f1117;
      --surface:  #1a1d2e;
      --border:   #2d3144;
      --text:     #e2e8f0;
      --muted:    #64748b;
      --accent:   #818cf8;
      --radius:   12px;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Segoe UI', 'Noto Sans TC', sans-serif;
      font-size: 15px;
      line-height: 1.6;
      padding: 24px 16px 64px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .page-header { text-align: center; margin-bottom: 32px; }
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
    .page-header h1 { font-size: 26px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px; }
    .page-header .sub { color: var(--muted); font-size: 13px; }
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
    .stat-card .label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .stat-card .value { font-size: 22px; font-weight: 700; color: #f1f5f9; }
    .stat-card .sub-value { font-size: 12px; color: var(--muted); }
    .chart-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 28px;
    }
    .section-title { font-size: 14px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; }
    .chart-wrapper { position: relative; height: 300px; }
    .highlights-section { margin-bottom: 28px; }
    .highlight-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 10px;
    }
    .highlight-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
    .highlight-index { font-size: 11px; color: var(--muted); min-width: 24px; }
    .highlight-time { font-size: 13px; font-weight: 600; color: #f1f5f9; font-variant-numeric: tabular-nums; }
    .highlight-emotion { font-size: 13px; font-weight: 700; }
    .highlight-intensity, .highlight-duration { font-size: 12px; color: var(--muted); margin-left: auto; }
    .highlight-messages { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
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
    .no-data { color: var(--muted); text-align: center; padding: 24px; }
    .footer { text-align: center; margin-top: 40px; color: var(--muted); font-size: 12px; }
    .footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
<div class="container">
  <header class="page-header">
    <div class="badge">Chat Mood Meter</div>
    <h1>直播情緒報告</h1>
    <p class="sub">${startedStr}｜${durationStr}</p>
  </header>

  <div class="summary-grid">
    <div class="stat-card">
      <span class="label">主要情緒</span>
      <span class="value" style="color: ${dominantColor};">${dominantLabel}</span>
      <span class="sub-value">${dominantEmotion}</span>
    </div>
    <div class="stat-card">
      <span class="label">平均強度</span>
      <span class="value">${(avgIntensity * 100).toFixed(1)}%</span>
      <span class="sub-value">峰值 ${(peakIntensity * 100).toFixed(1)}%</span>
    </div>
    <div class="stat-card">
      <span class="label">訊息總數</span>
      <span class="value">${totalMessages.toLocaleString()}</span>
      <span class="sub-value">則聊天訊息</span>
    </div>
    <div class="stat-card">
      <span class="label">高光時刻</span>
      <span class="value">${filteredHighlights.length}</span>
      <span class="sub-value">個 highlight</span>
    </div>
    <div class="stat-card">
      <span class="label">分析快照</span>
      <span class="value">${snapshots.length}</span>
      <span class="sub-value">個時間窗格</span>
    </div>
    <div class="stat-card">
      <span class="label">直播時長</span>
      <span class="value">${durationStr}</span>
      <span class="sub-value">${new Date(streamStartedAt).toLocaleDateString('zh-TW')}</span>
    </div>
  </div>

  <div class="chart-section">
    <div class="section-title">📈 情緒強度時間軸</div>
    <div class="chart-wrapper">
      <canvas id="moodChart"></canvas>
    </div>
  </div>

  <div class="highlights-section">
    <div class="section-title">⚡ 高光時刻</div>
    ${highlightListHTML}
  </div>

  <footer class="footer">
    由 <strong>Chat Mood Meter</strong> 生成 · ${new Date().toLocaleString('zh-TW', { hour12: false })}
    · Session: ${escapeHTML(sessionId)}
  </footer>
</div>

<script>
const CHART_DATA = ${chartData};
const HIGHLIGHTS = ${highlightsData};

if (CHART_DATA.labels.length === 0) {
  document.getElementById('moodChart').parentElement.innerHTML =
    '<p style="color:#64748b;text-align:center;padding:40px;">無快照資料</p>';
} else {
  const startTs = ${startTs};
  const endTs   = ${endTs};
  const tRange  = endTs - startTs || 1;

  const highlightLinesPlugin = {
    id: 'highlightLines',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      HIGHLIGHTS.forEach(h => {
        const ratio = (h.timestamp - startTs) / tRange;
        const x = chartArea.left + ratio * (chartArea.right - chartArea.left);
        if (x < chartArea.left || x > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = h.color;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚡' + h.emotionLabel, x, chartArea.top + 10);
        ctx.restore();
      });
    }
  };

  let labels = CHART_DATA.labels;
  let d = { hype: CHART_DATA.hype, funny: CHART_DATA.funny, sad: CHART_DATA.sad, angry: CHART_DATA.angry, intensity: CHART_DATA.intensity };
  const MAX_POINTS = 300;
  if (labels.length > MAX_POINTS) {
    const step = Math.ceil(labels.length / MAX_POINTS);
    const sample = i => i % step === 0;
    labels      = labels.filter((_, i) => sample(i));
    d.hype      = d.hype.filter((_, i) => sample(i));
    d.funny     = d.funny.filter((_, i) => sample(i));
    d.sad       = d.sad.filter((_, i) => sample(i));
    d.angry     = d.angry.filter((_, i) => sample(i));
    d.intensity = d.intensity.filter((_, i) => sample(i));
  }

  const ctx = document.getElementById('moodChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '整體強度', data: d.intensity, borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.08)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0 },
        { label: '炒熱',   data: d.hype,      borderColor: '#f59e0b', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: '好笑',   data: d.funny,     borderColor: '#10b981', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: '悲傷',   data: d.sad,       borderColor: '#60a5fa', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: '憤怒',   data: d.angry,     borderColor: '#f87171', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e2235',
          borderColor: '#2d3144',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          callbacks: { label: (ctx) => \` \${ctx.dataset.label}: \${(ctx.parsed.y * 100).toFixed(1)}%\` },
        },
      },
      scales: {
        x: { ticks: { color: '#475569', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#1e2235' } },
        y: { min: 0, max: 1, ticks: { color: '#475569', callback: v => (v * 100).toFixed(0) + '%' }, grid: { color: '#1e2235' } },
      },
    },
    plugins: [highlightLinesPlugin],
  });
}
</script>
</body>
</html>`;
}

// ──────────────────────────────────────────
// 內部工具函式
// ──────────────────────────────────────────

/** 格式化時間戳為可讀字串 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', { hour12: false });
}

/** 格式化時長（毫秒 → 時:分:秒） */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** HTML 跳脫，避免 XSS */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
