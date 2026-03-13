import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { api } from '../lib/api';
import './SessionDetail.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// ── 情緒配色 ────────────────────────────────────────────────
const EMOTION_COLORS = {
  hype:   '#ff6b6b',
  funny:  '#ffd93d',
  sad:    '#74b9ff',
  angry:  '#ff4757',
};

const EMOTION_EMOJI: Record<string, string> = {
  hype:    '🔥',
  funny:   '😂',
  sad:     '😢',
  angry:   '😤',
  neutral: '😐',
};

const EMOTION_LABELS: Record<string, string> = {
  hype:    'Hype',
  funny:   'Funny',
  sad:     'Sad',
  angry:   'Angry',
  neutral: 'Neutral',
};

// ── 工具函數 ─────────────────────────────────────────────────
function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end   = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diff  = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDateTime(ts: string): string {
  return new Date(ts).toLocaleString('zh-TW', {
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function formatTimeShort(ts: string): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function getEmotionColor(emotion: string): string {
  return (EMOTION_COLORS as Record<string, string>)[emotion] ?? '#8b949e';
}

// ── 高光區域自訂 Plugin ──────────────────────────────────────
interface HighlightZone {
  index: number;
  emotion: string;
}

function makeHighlightPlugin(zones: HighlightZone[]): Plugin<'line'> {
  return {
    id: 'highlightZones',
    beforeDraw(chart) {
      if (!zones.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale || !chartArea) return;

      ctx.save();
      zones.forEach(({ index, emotion }) => {
        const xPx = xScale.getPixelForValue(index);
        if (xPx < chartArea.left || xPx > chartArea.right) return;

        const color = getEmotionColor(emotion);
        // 色帶
        ctx.fillStyle = `${color}22`;
        ctx.fillRect(xPx - 12, chartArea.top, 24, chartArea.bottom - chartArea.top);

        // 垂直線
        ctx.strokeStyle = `${color}99`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xPx, chartArea.top);
        ctx.lineTo(xPx, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.restore();
    },
  };
}

// ── 導出 Dropdown ────────────────────────────────────────────
function ExportDropdown({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const formats = [
    { key: 'json',     label: '📄 JSON'             },
    { key: 'csv',      label: '📊 CSV'              },
    { key: 'edl',      label: '🎬 EDL (Premiere)'   },
    { key: 'chapters', label: '📺 YouTube Chapters'  },
    { key: 'srt',      label: '💬 SRT 字幕'          },
    { key: 'html',     label: '🌐 HTML 報告'         },
  ];

  // 點擊外部關閉
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="export-dropdown" ref={ref}>
      <button className="export-btn" onClick={() => setOpen(v => !v)}>
        📥 導出 <span className="chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="dropdown-menu">
          {formats.map(f => (
            <a
              key={f.key}
              href={api.exportSession(sessionId, f.key)}
              download
              onClick={() => setOpen(false)}
            >
              {f.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主頁面 ───────────────────────────────────────────────────
export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session,    setSession]    = useState<any>(null);
  const [snapshots,  setSnapshots]  = useState<any[]>([]);
  const [highlights, setHighlights] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.getSession(id),
      api.getSnapshots(id),
      api.getHighlights(id),
    ])
      .then(([s, snaps, hl]) => {
        setSession(s);
        setSnapshots(snaps?.data ?? snaps ?? []);
        setHighlights(hl?.data ?? hl ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Chart 資料 ──────────────────────────────────────────
  const chartData = useMemo(() => {
    const labels = snapshots.map(s => formatTimeShort(s.timestamp));
    const get = (s: any, key: string) =>
      s.emotions?.[key] ?? s[key] ?? 0;

    return {
      labels,
      datasets: [
        {
          label: 'Hype 🔥',
          data:            snapshots.map(s => get(s, 'hype')),
          borderColor:     EMOTION_COLORS.hype,
          backgroundColor: `${EMOTION_COLORS.hype}18`,
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: 'Funny 😂',
          data:            snapshots.map(s => get(s, 'funny')),
          borderColor:     EMOTION_COLORS.funny,
          backgroundColor: `${EMOTION_COLORS.funny}18`,
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: 'Sad 😢',
          data:            snapshots.map(s => get(s, 'sad')),
          borderColor:     EMOTION_COLORS.sad,
          backgroundColor: `${EMOTION_COLORS.sad}18`,
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          label: 'Angry 😤',
          data:            snapshots.map(s => get(s, 'angry')),
          borderColor:     EMOTION_COLORS.angry,
          backgroundColor: `${EMOTION_COLORS.angry}18`,
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    };
  }, [snapshots]);

  // ── 高光 → chart 索引映射 ──────────────────────────────
  const highlightZones = useMemo<HighlightZone[]>(() => {
    return highlights.map(hl => {
      const hlTime = new Date(hl.timestamp).getTime();
      let nearestIdx = 0;
      let minDiff = Infinity;
      snapshots.forEach((s, i) => {
        const diff = Math.abs(new Date(s.timestamp).getTime() - hlTime);
        if (diff < minDiff) { minDiff = diff; nearestIdx = i; }
      });
      return { index: nearestIdx, emotion: hl.emotion ?? 'hype' };
    });
  }, [highlights, snapshots]);

  const highlightPlugin = useMemo(
    () => makeHighlightPlugin(highlightZones),
    [highlightZones],
  );

  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e6edf3',
          usePointStyle: true,
          padding: 20,
          font: { size: 12 },
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: '#21262d',
        borderColor: '#30363d',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#8b949e',
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(1)}%`,
        },
      },
      title: { display: false },
    },
    scales: {
      x: {
        ticks: {
          color: '#8b949e',
          maxTicksLimit: 12,
          maxRotation: 0,
          font: { size: 11 },
        },
        grid: { color: '#21262d' },
      },
      y: {
        min: 0,
        max: 1,
        ticks: {
          color: '#8b949e',
          callback: (v) => `${Math.round((v as number) * 100)}%`,
          font: { size: 11 },
        },
        grid: { color: '#21262d' },
      },
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
  }), []);

  // ── Stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const avgIntensity = highlights.length
      ? highlights.reduce((s, h) => s + (h.intensity ?? 0), 0) / highlights.length
      : 0;
    return {
      duration:     session ? formatDuration(session.startedAt, session.endedAt) : '—',
      messageCount: session?.messageCount ?? snapshots.reduce((s, sn) => s + (sn.messageCount ?? 0), 0),
      highlightCount: highlights.length,
      avgIntensity:   Math.round(avgIntensity * 100),
    };
  }, [session, snapshots, highlights]);

  // ── Render ─────────────────────────────────────────────
  if (loading) return <div className="loading">載入中…</div>;
  if (error)   return <div className="sd-error">⚠️ {error}</div>;
  if (!session) return <div className="sd-error">場次不存在</div>;

  const statusClass = session.status === 'live'
    ? 'badge badge-live'
    : session.status === 'ended'
    ? 'badge badge-ended'
    : 'badge badge-idle';

  return (
    <div className="session-detail">

      {/* ── Header ── */}
      <div className="sd-header">
        <div className="sd-header-left">
          <Link to="/dashboard" className="back-link">← Dashboard</Link>
          <div className="sd-title">
            <h1>{session.channelName ?? session.channel ?? '未知頻道'}</h1>
            <div className="sd-meta">
              <span className={statusClass}>
                {session.status === 'live' ? '● 直播中' : session.status === 'ended' ? '已結束' : session.status}
              </span>
              {session.startedAt && (
                <span className="sd-date">{formatDateTime(session.startedAt)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="sd-header-right">
          <ExportDropdown sessionId={session.id ?? id!} />
        </div>
      </div>

      {/* ── Stats 卡片 ── */}
      <div className="sd-stats">
        <div className="stat-card">
          <div className="stat-icon">⏱</div>
          <div className="stat-value">{stats.duration}</div>
          <div className="stat-label">持續時間</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💬</div>
          <div className="stat-value">{stats.messageCount.toLocaleString()}</div>
          <div className="stat-label">訊息總數</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{stats.highlightCount}</div>
          <div className="stat-label">高光時刻</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📈</div>
          <div className="stat-value">{stats.avgIntensity}%</div>
          <div className="stat-label">平均強度</div>
        </div>
      </div>

      {/* ── Emotion Timeline 圖表 ── */}
      <div className="sd-section">
        <h2 className="section-title">情緒時間軸</h2>
        {snapshots.length === 0 ? (
          <div className="sd-empty">尚無快照資料</div>
        ) : (
          <div className="chart-container">
            <Line
              data={chartData}
              options={chartOptions}
              plugins={[highlightPlugin]}
            />
          </div>
        )}
        {highlightZones.length > 0 && (
          <div className="chart-legend-note">
            ▲ 彩色垂直線為高光時刻標記
          </div>
        )}
      </div>

      {/* ── Highlights 列表 ── */}
      <div className="sd-section">
        <h2 className="section-title">高光時刻 ({highlights.length})</h2>
        {highlights.length === 0 ? (
          <div className="sd-empty">本場次尚無高光記錄</div>
        ) : (
          <div className="highlights-grid">
            {highlights.map((hl, idx) => (
              <HighlightCard key={hl.id ?? idx} highlight={hl} sessionId={session.id ?? id!} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ── 高光卡片 ─────────────────────────────────────────────────
function HighlightCard({ highlight: hl, sessionId }: { highlight: any; sessionId: string }) {
  const emotion  = hl.emotion ?? 'neutral';
  const emoji    = EMOTION_EMOJI[emotion] ?? '✨';
  const label    = EMOTION_LABELS[emotion] ?? emotion;
  const color    = getEmotionColor(emotion);
  const intensity = Math.round((hl.intensity ?? 0) * 100);
  const messages: string[] = (hl.sampleMessages ?? hl.sample_messages ?? []).slice(0, 3);

  return (
    <div className="highlight-card" style={{ borderLeftColor: color }}>
      <div className="hl-top">
        <div className="hl-emotion">
          <span className="hl-emoji">{emoji}</span>
          <span className="hl-label" style={{ color }}>{label}</span>
        </div>
        <div className="hl-time">{hl.timestamp ? formatTimeShort(hl.timestamp) : '—'}</div>
      </div>

      <div className="hl-intensity-bar">
        <div
          className="hl-intensity-fill"
          style={{ width: `${intensity}%`, background: color }}
        />
        <span className="hl-intensity-text">{intensity}%</span>
      </div>

      {messages.length > 0 && (
        <div className="hl-messages">
          {messages.map((msg, i) => (
            <div key={i} className="hl-message">💬 {msg}</div>
          ))}
        </div>
      )}

      <div className="hl-actions">
        <a
          href={`/api/sessions/${sessionId}/highlights/${hl.id}/export`}
          download
          className="hl-export-btn"
        >
          ⬇ 導出此高光
        </a>
      </div>
    </div>
  );
}
