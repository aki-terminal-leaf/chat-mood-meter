/**
 * Chat Mood Meter Dashboard — 前端主邏輯
 * 純 Vanilla JS，hash-based 路由
 */

'use strict';

// ── 常數定義 ──────────────────────────────────────────────
const EMOTION_COLORS = {
  hype:    '#ff6b35',
  funny:   '#ffd700',
  sad:     '#4a90d9',
  angry:   '#ff4444',
  neutral: '#888888',
};

const EMOTION_EMOJI = {
  hype: '🔥', funny: '😂', sad: '😢', angry: '😡', neutral: '😐',
};

const API_BASE = window.location.origin;

// ── Chart.js 全域深色主題 ─────────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

// ── 工具函式 ──────────────────────────────────────────────

/** API 請求封裝 */
async function api(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/** 時間格式化 */
function fmtDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** 持續時間格式化（ms → 可讀字串） */
function fmtDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** 數字簡寫（1200 → 1.2k） */
function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/** 取得情緒顏色 */
function emotionColor(e) { return EMOTION_COLORS[e] || EMOTION_COLORS.neutral; }

/** 設定狀態列 */
function setStatus(ok, text) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) dot.className = `status-dot ${ok ? 'ok' : 'error'}`;
  if (txt) txt.textContent = text;
}

/** 從 template 複製內容到 #app */
function renderTemplate(templateId) {
  const tpl = document.getElementById(templateId);
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));
}

/** 顯示 loading */
function showLoading() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading-screen"><div class="spinner"></div><p>Loading…</p></div>';
}

/** 顯示空狀態 */
function showEmpty(msg = 'No data available yet.') {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="loading-screen"><p style="font-size:48px">📭</p><p>${msg}</p></div>`;
}

// ── 儲存 Chart 實例（銷毀用） ─────────────────────────────
const charts = {};
function destroyCharts() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
  for (const k in charts) delete charts[k];
}

// ══════════════════════════════════════════════════════════
// 頁面一：Session 列表
// ══════════════════════════════════════════════════════════

async function renderSessionsPage() {
  showLoading();
  try {
    const [sessions, stats] = await Promise.all([
      api('/api/sessions'),
      api('/api/stats').catch(() => null),
    ]);

    if (!sessions || sessions.length === 0) {
      showEmpty('No sessions recorded yet. Start streaming to see data!');
      setStatus(true, 'Connected — no data');
      return;
    }

    destroyCharts();
    renderTemplate('tpl-sessions');
    setStatus(true, `${sessions.length} sessions`);

    // 填入全域統計
    if (stats) {
      setText('val-total-sessions', String(stats.totalSessions || sessions.length));
      setText('val-total-duration', fmtDuration(stats.totalDuration));
      setText('val-total-messages', fmtNum(stats.totalMessages));
    }

    // 渲染場次卡片
    const container = document.getElementById('sessions-container');
    if (container) {
      container.innerHTML = sessions.map((s, i) => {
        const duration = s.ended_at ? s.ended_at - s.started_at : null;
        const dominant = s.dominant || 'neutral';
        return `
          <a href="#/session/${encodeURIComponent(s.session_id)}" class="session-card">
            <div class="session-card-header">
              <span class="session-date">${fmtDate(s.started_at)}</span>
              <span class="session-status ${s.ended_at ? 'ended' : 'live'}">${s.ended_at ? 'Ended' : 'Live'}</span>
            </div>
            <div class="session-meta">
              <div class="meta-item">
                <span class="meta-label">Duration</span>
                <span class="meta-value">${fmtDuration(duration)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Messages</span>
                <span class="meta-value">${fmtNum(s.total_messages)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Highlights</span>
                <span class="meta-value">${s.total_highlights || 0}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Mood</span>
                <span class="meta-value">${EMOTION_EMOJI[dominant] || '😐'} ${dominant}</span>
              </div>
            </div>
          </a>`;
      }).join('');
    }

    // 渲染趨勢圖
    renderTrendChart(sessions);
    renderRadarChart(stats);
    renderHeatmap(sessions);

    // 重新整理按鈕
    const btn = document.getElementById('btn-refresh');
    if (btn) btn.onclick = () => renderSessionsPage();

  } catch (err) {
    console.error('[Dashboard] Load sessions failed:', err);
    setStatus(false, 'Error loading');
    showEmpty('Failed to load sessions. Is the server running?');
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/** 跨場次趨勢堆疊長條圖 */
function renderTrendChart(sessions) {
  const canvas = document.getElementById('chart-trend');
  if (!canvas || sessions.length === 0) return;

  const labels = sessions.map(s => fmtDate(s.started_at)).reverse();
  const emotions = ['hype', 'funny', 'sad', 'angry'];

  // 從 session 資料提取情緒分數（如果有的話）
  const datasets = emotions.map(e => ({
    label: `${EMOTION_EMOJI[e]} ${e}`,
    data: sessions.map(s => (s[e] || 0) * 100).reverse(),
    backgroundColor: emotionColor(e) + '99',
    borderColor: emotionColor(e),
    borderWidth: 1,
  }));

  charts.trend = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45 } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Score %' } },
      },
    },
  });
}

/** 情緒雷達圖 */
function renderRadarChart(stats) {
  const canvas = document.getElementById('chart-radar');
  if (!canvas || !stats) return;

  const emotions = ['hype', 'funny', 'sad', 'angry'];
  const values = emotions.map(e => ((stats.avgEmotions && stats.avgEmotions[e]) || 0) * 100);

  charts.radar = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: emotions.map(e => `${EMOTION_EMOJI[e]} ${e.charAt(0).toUpperCase() + e.slice(1)}`),
      datasets: [{
        label: 'Average Emotion',
        data: values,
        backgroundColor: 'rgba(129, 140, 248, 0.2)',
        borderColor: '#818cf8',
        borderWidth: 2,
        pointBackgroundColor: emotions.map(e => emotionColor(e)),
        pointRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 25, backdropColor: 'transparent' },
          grid: { color: 'rgba(255,255,255,0.08)' },
          angleLines: { color: 'rgba(255,255,255,0.08)' },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/** 活躍度熱力圖（GitHub contribution style） */
function renderHeatmap(sessions) {
  const container = document.getElementById('heatmap-container');
  if (!container) return;

  // 計算每天的場次數
  const dayCounts = {};
  sessions.forEach(s => {
    const d = new Date(s.started_at).toISOString().slice(0, 10);
    dayCounts[d] = (dayCounts[d] || 0) + 1;
  });

  // 產生最近 90 天的格子
  const today = new Date();
  const cells = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = dayCounts[key] || 0;
    cells.push({ date: key, count });
  }

  const maxCount = Math.max(1, ...cells.map(c => c.count));

  container.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:3px;padding:8px 0">
      ${cells.map(c => {
        const opacity = c.count === 0 ? 0.1 : 0.2 + (c.count / maxCount) * 0.8;
        return `<div title="${c.date}: ${c.count} sessions"
          style="width:12px;height:12px;border-radius:2px;
          background:rgba(129,140,248,${opacity})"></div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:#475569;margin-top:4px">Last 90 days</div>
  `;
}

// ══════════════════════════════════════════════════════════
// 頁面二：Session 詳情
// ══════════════════════════════════════════════════════════

async function renderSessionDetail(sessionId) {
  showLoading();
  try {
    const [summary, snapshots, highlights] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(sessionId)}`),
      api(`/api/sessions/${encodeURIComponent(sessionId)}/snapshots`),
      api(`/api/sessions/${encodeURIComponent(sessionId)}/highlights`),
    ]);

    destroyCharts();
    renderTemplate('tpl-session-detail');

    setText('detail-session-id', fmtDate(summary.started_at || sessionId));
    setStatus(true, 'Viewing session');

    // 摘要卡片
    const grid = document.getElementById('summary-grid');
    if (grid && summary) {
      const duration = summary.ended_at ? summary.ended_at - summary.started_at : null;
      grid.innerHTML = [
        { label: 'Duration', value: fmtDuration(duration), sub: '' },
        { label: 'Messages', value: fmtNum(summary.total_messages), sub: '' },
        { label: 'Highlights', value: String(summary.total_highlights || highlights.length), sub: '' },
        { label: 'Dominant', value: `${EMOTION_EMOJI[summary.dominant || 'neutral']} ${summary.dominant || 'neutral'}`, sub: '' },
      ].map(c => `
        <div class="summary-card">
          <span class="summary-label">${c.label}</span>
          <span class="summary-value">${c.value}</span>
          ${c.sub ? `<span class="summary-sub">${c.sub}</span>` : ''}
        </div>
      `).join('');
    }

    // 時間軸折線圖
    renderTimelineChart(snapshots, highlights);

    // 高光列表
    renderHighlights(highlights, sessionId);

    // 導出按鈕
    document.querySelectorAll('.btn-export').forEach(btn => {
      btn.onclick = () => {
        const fmt = btn.dataset.format;
        window.open(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/export/${fmt}`, '_blank');
      };
    });

  } catch (err) {
    console.error('[Dashboard] Load session detail failed:', err);
    setStatus(false, 'Error');
    showEmpty('Failed to load session details.');
  }
}

/** 情緒時間軸折線圖 */
function renderTimelineChart(snapshots, highlights) {
  const canvas = document.getElementById('chart-timeline');
  if (!canvas || !snapshots || snapshots.length === 0) return;

  // 如果資料量太大，取樣
  const maxPoints = 500;
  const step = Math.max(1, Math.floor(snapshots.length / maxPoints));
  const sampled = snapshots.filter((_, i) => i % step === 0);

  const labels = sampled.map(s => {
    const d = new Date(s.timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  });

  const emotions = ['hype', 'funny', 'sad', 'angry'];
  const datasets = emotions.map(e => ({
    label: `${EMOTION_EMOJI[e]} ${e}`,
    data: sampled.map(s => ((s[e] ?? s.scores?.[e] ?? 0) * 100).toFixed(1)),
    borderColor: emotionColor(e),
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.3,
  }));

  // intensity 面積圖
  datasets.push({
    label: '💪 intensity',
    data: sampled.map(s => ((s.intensity ?? 0) * 100).toFixed(1)),
    borderColor: 'rgba(129, 140, 248, 0.6)',
    backgroundColor: 'rgba(129, 140, 248, 0.1)',
    borderWidth: 1,
    pointRadius: 0,
    tension: 0.3,
    fill: true,
  });

  // 高光垂直線 annotation（用 plugin）
  const highlightAnnotations = (highlights || []).map(h => {
    // 找最近的 sampled index
    const idx = sampled.findIndex(s => s.timestamp >= h.timestamp);
    return idx >= 0 ? { idx, emotion: h.emotion, intensity: h.intensity } : null;
  }).filter(Boolean);

  charts.timeline = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (item) => `${item.dataset.label}: ${item.formattedValue}%`,
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 20, maxRotation: 0 },
          title: { display: true, text: 'Time' },
        },
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Score %' },
        },
      },
    },
  });
}

/** 高光列表 */
function renderHighlights(highlights, sessionId) {
  const container = document.getElementById('highlights-container');
  const countEl = document.getElementById('highlight-count');
  if (!container) return;

  if (countEl) countEl.textContent = `${highlights.length} detected`;

  if (highlights.length === 0) {
    container.innerHTML = '<p style="color:#475569;padding:12px;text-align:center">No highlights detected in this session.</p>';
    return;
  }

  container.innerHTML = highlights.map((h, i) => {
    const color = emotionColor(h.emotion);
    const emoji = EMOTION_EMOJI[h.emotion] || '⭐';
    const pct = Math.round((h.intensity || 0) * 100);
    const time = fmtDate(h.timestamp);

    // sample_messages 可能是 JSON 字串
    let samples = h.sample_messages || h.sampleMessages || [];
    if (typeof samples === 'string') {
      try { samples = JSON.parse(samples); } catch { samples = [samples]; }
    }

    return `
      <div class="highlight-card" style="border-left-color:${color}" data-index="${i}">
        <div class="highlight-header">
          <span class="highlight-index">#${i + 1}</span>
          <span class="highlight-time">${time}</span>
          <span class="highlight-emotion" style="color:${color}">${emoji} ${h.emotion}</span>
          <span class="highlight-intensity">${pct}%</span>
          <span class="highlight-duration">${fmtDuration(h.duration)}</span>
        </div>
        ${samples.length > 0 ? `
          <div class="highlight-messages">
            ${samples.slice(0, 3).map(m => `<span class="sample-msg">${escapeHtml(String(m))}</span>`).join('')}
          </div>` : ''}
      </div>`;
  }).join('');

  // 點擊高光 → 滾動到圖表
  container.querySelectorAll('.highlight-card').forEach(card => {
    card.onclick = () => {
      const chart = document.getElementById('chart-timeline');
      if (chart) chart.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

/** HTML 跳脫 */
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ══════════════════════════════════════════════════════════
// 路由
// ══════════════════════════════════════════════════════════

function route() {
  const hash = window.location.hash || '#/';

  // 更新導覽列 active 狀態
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

  if (hash.startsWith('#/session/')) {
    const id = decodeURIComponent(hash.replace('#/session/', ''));
    renderSessionDetail(id);
  } else {
    const navHome = document.getElementById('nav-home');
    if (navHome) navHome.classList.add('active');
    renderSessionsPage();
  }
}

// ── 初始化 ────────────────────────────────────────────────
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
