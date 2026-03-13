/**
 * discord-notification.test.ts — Discord 通知模組單元測試
 *
 * mock global fetch，驗證 embed 結構、情緒對應、錯誤處理等行為。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendDiscordNotification,
  sendDiscordSessionNotification,
  type HighlightNotification,
} from '../src/notifications/discord.js';

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true });
});

// ── 輔助函式 ──────────────────────────────────────────────────────────────────

function getLastFetchBody(): any {
  const call = mockFetch.mock.calls[0];
  const body = call[1].body as string;
  return JSON.parse(body);
}

// ── 測試 ──────────────────────────────────────────────────────────────────────

describe('sendDiscordNotification', () => {
  const baseHighlight: HighlightNotification = {
    emotion:     'hype',
    intensity:   0.75,
    channelName: 'test-streamer',
    offsetSec:   3661, // 1:01:01
    samples:     ['wow!', 'PogChamp', 'LETS GO'],
    sessionId:   'abcdef12-3456-7890-abcd-ef1234567890',
  };

  it('1. 應使用正確的 endpoint 和 HTTP method', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/abc';
    await sendDiscordNotification(webhookUrl, baseHighlight);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(webhookUrl);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('1b. 應發送正確的 embed 結構（username, embeds 陣列）', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', baseHighlight);

    const body = getLastFetchBody();
    expect(body).toHaveProperty('username', 'Chat Mood Meter');
    expect(body).toHaveProperty('embeds');
    expect(Array.isArray(body.embeds)).toBe(true);
    expect(body.embeds).toHaveLength(1);
  });

  it('1c. embed 應包含 title、description、color、fields、footer、timestamp', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', baseHighlight);

    const embed = getLastFetchBody().embeds[0];
    expect(embed).toHaveProperty('title');
    expect(embed).toHaveProperty('description');
    expect(embed).toHaveProperty('color');
    expect(embed).toHaveProperty('fields');
    expect(embed).toHaveProperty('footer');
    expect(embed).toHaveProperty('timestamp');
  });

  it('2a. hype 情緒 → 🔥 emoji 和珊瑚紅顏色', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'hype',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('🔥');
    expect(embed.title).toContain('HYPE');
    expect(embed.color).toBe(0xff6b6b);
  });

  it('2b. funny 情緒 → 😂 emoji 和金黃顏色', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'funny',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('😂');
    expect(embed.color).toBe(0xffd93d);
  });

  it('2c. sad 情緒 → 😢 emoji 和天藍顏色', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'sad',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('😢');
    expect(embed.color).toBe(0x74b9ff);
  });

  it('2d. angry 情緒 → 😠 emoji 和緋紅顏色', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'angry',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('😠');
    expect(embed.color).toBe(0xff4757);
  });

  it('2e. neutral 情緒 → 😐 emoji 和灰色', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'neutral',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('😐');
    expect(embed.color).toBe(0xa4b0be);
  });

  it('2f. 未知情緒 → 🎭 fallback emoji', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      emotion: 'unknown-emotion',
    });

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('🎭');
  });

  it('3. fetch 失敗時不拋出，回傳 false', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      sendDiscordNotification('https://discord.com/api/webhooks/test', baseHighlight)
    ).resolves.toBe(false);
  });

  it('3b. fetch 回傳 ok:false 時回傳 false', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await sendDiscordNotification(
      'https://discord.com/api/webhooks/test',
      baseHighlight,
    );
    expect(result).toBe(false);
  });

  it('3c. fetch 成功時回傳 true', async () => {
    const result = await sendDiscordNotification(
      'https://discord.com/api/webhooks/test',
      baseHighlight,
    );
    expect(result).toBe(true);
  });

  it('6. embed fields 應包含 Channel / Intensity / Time', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', baseHighlight);

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    expect(Array.isArray(fields)).toBe(true);

    const channelField = fields.find(f => f.name.includes('頻道'));
    const intensityField = fields.find(f => f.name.includes('強度'));
    const timeField = fields.find(f => f.name.includes('時間'));

    expect(channelField).toBeDefined();
    expect(intensityField).toBeDefined();
    expect(timeField).toBeDefined();

    expect(channelField!.value).toBe('test-streamer');
  });

  it('7. 強度百分比計算正確（0.75 → 75%）', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      intensity: 0.75,
    });

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const intensityField = fields.find(f => f.name.includes('強度'));
    expect(intensityField!.value).toContain('75%');
  });

  it('7b. 強度 0 → 0%，強度 1 → 100%', async () => {
    // 強度 0
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      intensity: 0,
    });
    let fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    let intensityField = fields.find(f => f.name.includes('強度'));
    expect(intensityField!.value).toContain('0%');

    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    // 強度 1
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      intensity: 1,
    });
    fields = getLastFetchBody().embeds[0].fields;
    intensityField = fields.find(f => f.name.includes('強度'));
    expect(intensityField!.value).toContain('100%');
  });

  it('8. offsetSec 格式化正確（3661 → 1:01:01）', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      offsetSec: 3661,
    });

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const timeField = fields.find(f => f.name.includes('時間'));
    expect(timeField!.value).toBe('1:01:01');
  });

  it('8b. offsetSec 0 → 0:00:00', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      offsetSec: 0,
    });

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const timeField = fields.find(f => f.name.includes('時間'));
    expect(timeField!.value).toBe('0:00:00');
  });

  it('8c. offsetSec 90 → 0:01:30', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      offsetSec: 90,
    });

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const timeField = fields.find(f => f.name.includes('時間'));
    expect(timeField!.value).toBe('0:01:30');
  });

  it('footer 應包含 sessionId 的前 8 碼', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', baseHighlight);

    const footer = getLastFetchBody().embeds[0].footer;
    expect(footer.text).toContain('abcdef12');
  });

  it('samples 應作為 description（最多 3 筆引言）', async () => {
    await sendDiscordNotification('https://discord.com/api/webhooks/test', {
      ...baseHighlight,
      samples: ['msg1', 'msg2', 'msg3', 'msg4'],
    });

    const description: string = getLastFetchBody().embeds[0].description;
    expect(description).toContain('> msg1');
    expect(description).toContain('> msg2');
    expect(description).toContain('> msg3');
    // msg4 超過 3 筆，不應出現
    expect(description).not.toContain('msg4');
  });
});

// ── sendDiscordSessionNotification ───────────────────────────────────────────

describe('sendDiscordSessionNotification', () => {
  const baseSession = {
    channelName:    'test-streamer',
    sessionId:      'abcdef12-3456-7890-abcd-ef1234567890',
    durationSec:    7322,   // 2:02:02
    highlightCount: 15,
  };

  it('4. session.started — 標題為「直播開始監控」', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.started',
      baseSession,
    );

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('▶️');
    expect(embed.title).toContain('直播開始');
  });

  it('4b. session.started — 顏色為綠色（0x2ecc71）', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.started',
      baseSession,
    );

    expect(getLastFetchBody().embeds[0].color).toBe(0x2ecc71);
  });

  it('4c. session.started — description 包含頻道名稱', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.started',
      baseSession,
    );

    expect(getLastFetchBody().embeds[0].description).toContain('test-streamer');
  });

  it('5. session.ended — 標題為「直播結束」', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.ended',
      baseSession,
    );

    const embed = getLastFetchBody().embeds[0];
    expect(embed.title).toContain('⏹️');
    expect(embed.title).toContain('直播結束');
  });

  it('5b. session.ended — 顏色為灰色（0x95a5a6）', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.ended',
      baseSession,
    );

    expect(getLastFetchBody().embeds[0].color).toBe(0x95a5a6);
  });

  it('5c. session.ended — fields 包含時長與高光數', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.ended',
      baseSession,
    );

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;

    const durationField = fields.find(f => f.name.includes('時長'));
    const highlightField = fields.find(f => f.name.includes('高光'));

    expect(durationField).toBeDefined();
    expect(highlightField).toBeDefined();
    expect(highlightField!.value).toBe('15');
  });

  it('5d. session.ended — durationSec 格式化正確（7322 → 2:02:02）', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.ended',
      baseSession,
    );

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const durationField = fields.find(f => f.name.includes('時長'));
    expect(durationField!.value).toBe('2:02:02');
  });

  it('5e. session.ended — 無 durationSec 時顯示「—」', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.ended',
      { channelName: 'chan', sessionId: 'abc', highlightCount: 0 },
    );

    const fields: Array<{ name: string; value: string }> = getLastFetchBody().embeds[0].fields;
    const durationField = fields.find(f => f.name.includes('時長'));
    expect(durationField!.value).toBe('—');
  });

  it('footer 應包含 sessionId 前 8 碼', async () => {
    await sendDiscordSessionNotification(
      'https://discord.com/api/webhooks/test',
      'session.started',
      baseSession,
    );

    const footer = getLastFetchBody().embeds[0].footer;
    expect(footer.text).toContain('abcdef12');
  });

  it('fetch 失敗時不拋出，回傳 false', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));

    await expect(
      sendDiscordSessionNotification(
        'https://discord.com/api/webhooks/test',
        'session.started',
        baseSession,
      )
    ).resolves.toBe(false);
  });
});
