// Discord Webhook 通知模組
// 使用 Discord Embed 格式，讓高光通知一目了然

export interface HighlightNotification {
  emotion: string;
  intensity: number;
  channelName: string;
  offsetSec: number;
  samples: string[];
  sessionId?: string;
}

// 情緒對應 Emoji
const EMOJI: Record<string, string> = {
  hype:    '🔥',
  funny:   '😂',
  sad:     '😢',
  angry:   '😠',
  neutral: '😐',
};

// 情緒對應顏色（Discord embed color，十進位）
const COLOR: Record<string, number> = {
  hype:    0xff6b6b, // 珊瑚紅
  funny:   0xffd93d, // 金黃
  sad:     0x74b9ff, // 天藍
  angry:   0xff4757, // 緋紅
  neutral: 0xa4b0be, // 灰
};

/**
 * 將秒數格式化為 H:MM:SS
 */
function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 將 intensity（0~1）轉換為視覺進度條
 * 例：0.75 → ▓▓▓▓▓▓▓░░░ 75%
 */
function intensityBar(intensity: number): string {
  const filled = Math.round(intensity * 10);
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  return `${bar} ${Math.round(intensity * 100)}%`;
}

/**
 * 發送高光通知到 Discord Webhook
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  highlight: HighlightNotification,
): Promise<boolean> {
  const emoji = EMOJI[highlight.emotion] ?? '🎭';
  const color = COLOR[highlight.emotion] ?? 0xa4b0be;

  // 取前 3 筆聊天訊息作為預覽，格式化成引言
  const sampleText = highlight.samples
    .slice(0, 3)
    .map(s => `> ${s}`)
    .join('\n');

  const embed = {
    title: `${emoji} ${highlight.emotion.toUpperCase()} Highlight!`,
    description: sampleText || '（無聊天紀錄）',
    color,
    fields: [
      {
        name: '📺 頻道',
        value: highlight.channelName,
        inline: true,
      },
      {
        name: '📊 強度',
        value: intensityBar(highlight.intensity),
        inline: true,
      },
      {
        name: '⏱️ 時間點',
        value: formatTime(highlight.offsetSec),
        inline: true,
      },
    ],
    footer: {
      text: 'Chat Mood Meter' + (highlight.sessionId ? ` • Session ${highlight.sessionId.slice(0, 8)}` : ''),
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Chat Mood Meter',
        avatar_url: 'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/1f3ad.png',
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 發送 Session 開始/結束通知到 Discord
 */
export async function sendDiscordSessionNotification(
  webhookUrl: string,
  event: 'session.started' | 'session.ended',
  session: {
    channelName: string;
    sessionId: string;
    durationSec?: number;
    highlightCount?: number;
  },
): Promise<boolean> {
  const isStart = event === 'session.started';

  const embed = {
    title: isStart ? '▶️ 直播開始監控' : '⏹️ 直播結束',
    description: isStart
      ? `開始追蹤 **${session.channelName}** 的聊天情緒`
      : `已完成 **${session.channelName}** 的直播分析`,
    color: isStart ? 0x2ecc71 : 0x95a5a6,
    fields: isStart
      ? [{ name: '頻道', value: session.channelName, inline: true }]
      : [
          { name: '頻道', value: session.channelName, inline: true },
          { name: '時長', value: session.durationSec ? formatTime(session.durationSec) : '—', inline: true },
          { name: '高光數', value: String(session.highlightCount ?? 0), inline: true },
        ],
    footer: { text: `Chat Mood Meter • Session ${session.sessionId.slice(0, 8)}` },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Chat Mood Meter',
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
