import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { api } from '../lib/api';
import './Dashboard.css';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface Session {
  id: string;
  channelName: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  totalMessages: number;
  totalHighlights: number;
  dominantEmotion?: string;
  emotionBreakdown?: Record<string, number>;
}

const EMOTION_EMOJI: Record<string, string> = {
  hype: '🔥',
  funny: '😂',
  sad: '😢',
  angry: '😠',
  neutral: '😐',
};

const EMOTION_COLORS: Record<string, string> = {
  hype: '#ff6b35',
  funny: '#ffd166',
  sad: '#4ecdc4',
  angry: '#e63946',
  neutral: '#6c757d',
};

const STATUS_LABEL: Record<string, string> = {
  live: '直播中',
  ended: '已結束',
  idle: '待機',
};

function formatDuration(startedAt: string, endedAt?: string): string {
  if (!endedAt) return '進行中';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    api.getSessions(1, 20)
      .then((data: { data?: Session[] }) => setSessions(data.data || []))
      .finally(() => setLoading(false));
  }, []);

  // 統計數字
  const totalSessions = sessions.length;
  const totalHighlights = sessions.reduce((s, x) => s + (x.totalHighlights ?? 0), 0);
  const totalHours = sessions.reduce((s, x) => {
    if (!x.startedAt || !x.endedAt) return s;
    return s + (new Date(x.endedAt).getTime() - new Date(x.startedAt).getTime()) / 3600000;
  }, 0);

  // Chart.js 情緒趨勢
  useEffect(() => {
    if (!chartRef.current || sessions.length === 0) return;

    const recent7 = sessions.slice(0, 7).reverse();
    const labels = recent7.map(s => formatDate(s.startedAt));
    const emotions = ['hype', 'funny', 'sad', 'angry', 'neutral'];

    const datasets = emotions.map(emotion => ({
      label: `${EMOTION_EMOJI[emotion]} ${emotion}`,
      data: recent7.map(s => s.emotionBreakdown?.[emotion] ?? 0),
      backgroundColor: EMOTION_COLORS[emotion],
      borderRadius: 4,
    }));

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#b0b8c1', font: { size: 12 } },
          },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#7a8591' },
            grid: { color: '#2a2f36' },
          },
          y: {
            stacked: true,
            ticks: { color: '#7a8591' },
            grid: { color: '#2a2f36' },
          },
        },
      },
    });

    return () => {
      chartInstance.current?.destroy();
    };
  }, [sessions]);

  return (
    <div className="dashboard">
      {/* Stats Banner */}
      <section className="stats-banner">
        <div className="stat-card">
          <span className="stat-number">{totalSessions}</span>
          <span className="stat-label">場次總數</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{totalHighlights}</span>
          <span className="stat-label">精華時刻</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{totalHours.toFixed(1)}</span>
          <span className="stat-label">直播時數</span>
        </div>
      </section>

      <div className="dashboard-body">
        {/* Recent Sessions */}
        <section className="sessions-section">
          <h2 className="section-title">最近場次</h2>
          {loading ? (
            <div className="loading-state">載入中…</div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">還沒有任何場次記錄</div>
          ) : (
            <div className="sessions-table-wrapper">
              <table className="sessions-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>頻道</th>
                    <th>時長</th>
                    <th>精華</th>
                    <th>情緒</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(session => (
                    <tr key={session.id}>
                      <td className="date-cell">
                        <Link to={`/dashboard/sessions/${session.id}`}>
                          {formatDate(session.startedAt)}
                        </Link>
                      </td>
                      <td className="channel-cell">{session.channelName}</td>
                      <td>{formatDuration(session.startedAt, session.endedAt)}</td>
                      <td className="highlight-cell">{session.totalHighlights ?? 0}</td>
                      <td className="emotion-cell">
                        {session.dominantEmotion
                          ? EMOTION_EMOJI[session.dominantEmotion] ?? session.dominantEmotion
                          : '—'}
                      </td>
                      <td>
                        <span className={`status-badge status-${session.status}`}>
                          {STATUS_LABEL[session.status] ?? session.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Emotion Trends Chart */}
        {sessions.length > 0 && (
          <section className="chart-section">
            <h2 className="section-title">情緒分佈（最近 7 場）</h2>
            <div className="chart-container">
              <canvas ref={chartRef} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
