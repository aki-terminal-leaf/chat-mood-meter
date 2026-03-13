import { useState, useEffect, useRef, useMemo } from 'react';
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
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { api } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';
import './Live.css';

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

// ── 常數 ──────────────────────────────────────────────────────
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

// 最多保留 150 個資料點（~5min @ 2s interval）
const MAX_POINTS = 150;

interface EmotionPoint {
  time:    string;
  hype:    number;
  funny:   number;
  sad:     number;
  angry:   number;
  neutral: number;
}

interface ChatMessage {
  id:        string;
  timestamp: string;
  author:    string;
  text:      string;
}

// ── 工具 ───────────────────────────────────────────────────────
function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function getDominantEmotion(emotions: Omit<EmotionPoint, 'time'>): string {
  const entries = Object.entries(emotions) as [string, number][];
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0])[0];
}

// ── 主頁面 ─────────────────────────────────────────────────────
export default function Live() {
  const [channels,          setChannels]          = useState<any[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [dataPoints,        setDataPoints]         = useState<EmotionPoint[]>([]);
  const [chatMessages,      setChatMessages]       = useState<ChatMessage[]>([]);
  const [msgRate,           setMsgRate]            = useState(0);
  const msgCountRef    = useRef(0);
  const msgRateTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatBottomRef  = useRef<HTMLDivElement>(null);

  // ── 載入頻道列表 ──────────────────────────────────────────
  useEffect(() => {
    api.getChannels()
      .then((data: any) => {
        const list: any[] = data?.data ?? data ?? [];
        setChannels(list);
        // 自動選擇第一個正在直播的頻道
        const live = list.find((c: any) => c.status === 'live' || c.isLive);
        setSelectedChannelId(live?.id ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  // ── WebSocket 連線 ────────────────────────────────────────
  const { connected, lastMessage } = useWebSocket(selectedChannelId);

  // ── 處理 WebSocket 訊息 ────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;

    const { type, data } = lastMessage;

    if (type === 'snapshot' || type === 'emotion_update') {
      const emotions = data.emotions ?? data;
      const point: EmotionPoint = {
        time:    data.timestamp ?? new Date().toISOString(),
        hype:    emotions.hype    ?? 0,
        funny:   emotions.funny   ?? 0,
        sad:     emotions.sad     ?? 0,
        angry:   emotions.angry   ?? 0,
        neutral: emotions.neutral ?? 0,
      };
      setDataPoints(prev => [...prev.slice(-(MAX_POINTS - 1)), point]);
    }

    if (type === 'message' || type === 'chat_message') {
      const msg: ChatMessage = {
        id:        data.id ?? crypto.randomUUID(),
        timestamp: data.timestamp ?? new Date().toISOString(),
        author:    data.author ?? data.username ?? '匿名',
        text:      data.text ?? data.content ?? '',
      };
      setChatMessages(prev => [...prev.slice(-99), msg]);
      msgCountRef.current += 1;
    }
  }, [lastMessage]);

  // ── 計算訊息速率（每分鐘）────────────────────────────────
  useEffect(() => {
    msgRateTimer.current = setInterval(() => {
      setMsgRate(prev => {
        const rate = msgCountRef.current * 6; // 每10秒 * 6 = /min
        msgCountRef.current = 0;
        return rate;
      });
    }, 10_000);

    return () => {
      if (msgRateTimer.current) clearInterval(msgRateTimer.current);
    };
  }, []);

  // 自動捲動 Chat Feed
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Chart 資料 ───────────────────────────────────────────
  const chartData = useMemo(() => ({
    labels: dataPoints.map(p => formatTime(p.time)),
    datasets: [
      {
        label: 'Hype 🔥',
        data:            dataPoints.map(p => p.hype),
        borderColor:     EMOTION_COLORS.hype,
        backgroundColor: `${EMOTION_COLORS.hype}20`,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
      {
        label: 'Funny 😂',
        data:            dataPoints.map(p => p.funny),
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
        data:            dataPoints.map(p => p.sad),
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
        data:            dataPoints.map(p => p.angry),
        borderColor:     EMOTION_COLORS.angry,
        backgroundColor: `${EMOTION_COLORS.angry}18`,
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  }), [dataPoints]);

  const chartOptions = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
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
    },
    scales: {
      x: {
        ticks: {
          color: '#8b949e',
          maxTicksLimit: 8,
          maxRotation: 0,
          font: { size: 11 },
        },
        grid: { color: '#1c2128' },
      },
      y: {
        min: 0,
        max: 1,
        ticks: {
          color: '#8b949e',
          callback: (v) => `${Math.round((v as number) * 100)}%`,
          font: { size: 11 },
        },
        grid: { color: '#1c2128' },
      },
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
  }), []);

  // ── 目前主導情緒 ──────────────────────────────────────────
  const latest      = dataPoints[dataPoints.length - 1];
  const currentEmotion = latest
    ? getDominantEmotion({ hype: latest.hype, funny: latest.funny, sad: latest.sad, angry: latest.angry, neutral: latest.neutral })
    : null;
  const currentIntensity = currentEmotion && latest
    ? Math.round((latest as any)[currentEmotion] * 100)
    : 0;

  const selectedChannel = channels.find(c => c.id === selectedChannelId);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="live-page">

      {/* ── 頂部 Header ── */}
      <div className="live-header">
        <div className="live-title">
          <span className="live-dot" />
          <h1>即時監控</h1>
        </div>

        <div className="live-controls">
          <label htmlFor="channel-select" className="live-label">頻道</label>
          <select
            id="channel-select"
            className="channel-select"
            value={selectedChannelId ?? ''}
            onChange={e => {
              setSelectedChannelId(e.target.value || null);
              setDataPoints([]);
              setChatMessages([]);
            }}
          >
            <option value="">— 選擇頻道 —</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.displayName ?? c.id}
                {(c.status === 'live' || c.isLive) ? ' 🔴' : ''}
              </option>
            ))}
          </select>

          <div className={`conn-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● 已連線' : '○ 連線中…'}
          </div>
        </div>
      </div>

      {!selectedChannelId ? (
        <div className="live-empty">請選擇一個頻道開始監控</div>
      ) : (
        <div className="live-body">

          {/* ── 目前情緒狀態 ── */}
          <div className="current-emotion-panel">
            {currentEmotion ? (
              <>
                <div className="current-emoji">
                  {EMOTION_EMOJI[currentEmotion] ?? '😐'}
                </div>
                <div className="current-name" style={{ color: (EMOTION_COLORS as any)[currentEmotion] ?? '#8b949e' }}>
                  {EMOTION_LABELS[currentEmotion] ?? currentEmotion}
                </div>
                <div className="current-intensity-bar-wrap">
                  <div
                    className="current-intensity-bar"
                    style={{
                      width: `${currentIntensity}%`,
                      background: (EMOTION_COLORS as any)[currentEmotion] ?? '#8b949e',
                    }}
                  />
                </div>
                <div className="current-intensity-pct">{currentIntensity}%</div>
              </>
            ) : (
              <div className="current-waiting">等待資料…</div>
            )}
            <div className="msg-rate">
              <span className="msg-rate-value">{msgRate}</span>
              <span className="msg-rate-label">msgs/min</span>
            </div>
          </div>

          {/* ── 即時情緒圖表 ── */}
          <div className="live-section">
            <h2 className="live-section-title">
              即時情緒曲線
              <span className="live-window-note">（最近 {MAX_POINTS} 個資料點）</span>
            </h2>
            {dataPoints.length === 0 ? (
              <div className="live-chart-placeholder">
                <div className="pulse-ring" />
                <span>等待 {selectedChannel?.name ?? '頻道'} 的情緒資料…</span>
              </div>
            ) : (
              <div className="live-chart-container">
                <Line data={chartData} options={chartOptions} />
              </div>
            )}
          </div>

          {/* ── Live Chat Feed ── */}
          <div className="live-section">
            <h2 className="live-section-title">聊天訊息</h2>
            <div className="chat-feed">
              {chatMessages.length === 0 ? (
                <div className="chat-empty">等待聊天訊息…</div>
              ) : (
                chatMessages.map(msg => (
                  <div key={msg.id} className="chat-message">
                    <span className="chat-time">{formatTime(msg.timestamp)}</span>
                    <span className="chat-author">{msg.author}</span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
