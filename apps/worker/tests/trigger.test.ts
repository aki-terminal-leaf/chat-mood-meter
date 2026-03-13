/**
 * trigger.test.ts
 *
 * - Mock fetch（不呼叫真的 Twitch / YouTube API）
 * - 測試 Twitch webhook 簽名驗證
 * - 測試 stream.online / stream.offline 事件
 * - 測試 webhook_callback_verification
 * - 測試 YouTube polling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { TriggerService } from '../src/trigger.js';
import type { TriggerConfig, StreamEvent, YoutubeChannel } from '../src/trigger.js';

// ── Mock fetch ────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── 測試用常數 ────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-key';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

const DEFAULT_CONFIG: TriggerConfig = {
  twitchClientId: CLIENT_ID,
  twitchClientSecret: CLIENT_SECRET,
  twitchWebhookSecret: WEBHOOK_SECRET,
  youtubePollingIntervalMs: 100, // 測試用短一點
};

// ── 簽名計算輔助 ──────────────────────────────────────────────────

function computeSignature(messageId: string, timestamp: string, body: string): string {
  const message = messageId + timestamp + body;
  const hmac = createHmac('sha256', WEBHOOK_SECRET).update(message).digest('hex');
  return `sha256=${hmac}`;
}

function makeTwitchHeaders(
  body: string,
  messageType: string,
  overrideSignature?: string,
) {
  const messageId = 'msg-' + Math.random().toString(36).slice(2);
  const timestamp = new Date().toISOString();
  const signature = overrideSignature ?? computeSignature(messageId, timestamp, body);
  return {
    'twitch-eventsub-message-id': messageId,
    'twitch-eventsub-message-timestamp': timestamp,
    'twitch-eventsub-message-signature': signature,
    'twitch-eventsub-message-type': messageType,
  };
}

// ── 建立 Fastify + 掛載 TriggerService 的輔助 ─────────────────────

async function buildApp(
  onOnline: (e: StreamEvent) => Promise<void>,
  onOffline: (e: StreamEvent) => Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // 加掛 rawBody 支援（簡易版）
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as Record<string, unknown>).rawBody = body;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const service = new TriggerService(DEFAULT_CONFIG, onOnline, onOffline);
  service.registerWebhook(app);

  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('TriggerService - Twitch Webhook', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── 簽名驗證 ─────────────────────────────────────────────────

  it('有效簽名 → 回傳 200', async () => {
    const app = await buildApp(vi.fn(), vi.fn());
    const body = JSON.stringify({
      subscription: { type: 'stream.online' },
      event: {
        broadcaster_user_id: 'twitch-123',
        broadcaster_user_name: 'TestStreamer',
        broadcaster_user_login: 'teststreamer',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(body, 'notification'),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('無效簽名 → 回傳 403', async () => {
    const app = await buildApp(vi.fn(), vi.fn());
    const body = JSON.stringify({ test: 'data' });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(body, 'notification', 'sha256=invalid-signature'),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('缺少必要 header → 回傳 400', async () => {
    const app = await buildApp(vi.fn(), vi.fn());

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ── webhook_callback_verification ────────────────────────────

  it('webhook_callback_verification → 回傳 challenge', async () => {
    const app = await buildApp(vi.fn(), vi.fn());
    const challenge = 'pogchamp-challenge-token-xyz';
    const body = JSON.stringify({ challenge, subscription: {} });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(body, 'webhook_callback_verification'),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(challenge);
    await app.close();
  });

  // ── stream.online ─────────────────────────────────────────────

  it('stream.online → 呼叫 onStreamOnline', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(onOnline, vi.fn());

    const body = JSON.stringify({
      subscription: { type: 'stream.online' },
      event: {
        broadcaster_user_id: 'twitch-online-123',
        broadcaster_user_name: 'OnlineStreamer',
        broadcaster_user_login: 'onlinestreamer',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(body, 'notification'),
      },
      payload: body,
    });

    expect(onOnline).toHaveBeenCalledTimes(1);
    expect(onOnline).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'twitch',
        broadcasterId: 'twitch-online-123',
        channelName: 'onlinestreamer',
      }),
    );
    await app.close();
  });

  // ── stream.offline ────────────────────────────────────────────

  it('stream.offline → 呼叫 onStreamOffline', async () => {
    const onOffline = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(vi.fn(), onOffline);

    const body = JSON.stringify({
      subscription: { type: 'stream.offline' },
      event: {
        broadcaster_user_id: 'twitch-offline-456',
        broadcaster_user_name: 'OfflineStreamer',
        broadcaster_user_login: 'offlinestreamer',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(body, 'notification'),
      },
      payload: body,
    });

    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'twitch',
        broadcasterId: 'twitch-offline-456',
        channelName: 'offlinestreamer',
      }),
    );
    await app.close();
  });

  it('stream.online 和 stream.offline 各自只呼叫對應 handler', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const onOffline = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(onOnline, onOffline);

    const makeBody = (type: string, id: string) =>
      JSON.stringify({
        subscription: { type },
        event: {
          broadcaster_user_id: id,
          broadcaster_user_name: 'Streamer',
          broadcaster_user_login: 'streamer',
        },
      });

    const onlineBody = makeBody('stream.online', 'twitch-001');
    await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(onlineBody, 'notification'),
      },
      payload: onlineBody,
    });

    const offlineBody = makeBody('stream.offline', 'twitch-002');
    await app.inject({
      method: 'POST',
      url: '/webhooks/twitch',
      headers: {
        'content-type': 'application/json',
        ...makeTwitchHeaders(offlineBody, 'notification'),
      },
      payload: offlineBody,
    });

    expect(onOnline).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

// ── YouTube Polling ───────────────────────────────────────────────

describe('TriggerService - YouTube Polling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function makeYoutubeChannel(id: string): YoutubeChannel {
    return {
      channelId: `db-uuid-${id}`,
      platformChannelId: `yt-channel-${id}`,
      userId: `user-uuid-${id}`,
      accessToken: 'fake-access-token',
    };
  }

  function makeYoutubeLiveResponse(broadcastId: string, channelId: string, liveChatId: string) {
    return {
      items: [
        {
          id: broadcastId,
          snippet: { channelId, title: 'Test Live', liveChatId },
          status: { lifeCycleStatus: 'live', recordingStatus: 'recording' },
        },
      ],
    };
  }

  it('偵測到新直播 → 呼叫 onStreamOnline', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const onOffline = vi.fn().mockResolvedValue(undefined);
    const service = new TriggerService(DEFAULT_CONFIG, onOnline, onOffline);

    const channel = makeYoutubeChannel('001');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeYoutubeLiveResponse('broadcast-001', channel.platformChannelId, 'chat-001'),
    });

    service.startYoutubePolling(async () => [channel]);

    await new Promise(resolve => setTimeout(resolve, 250));
    service.stopYoutubePolling();

    expect(onOnline).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'youtube',
        channelId: channel.channelId,
        liveChatId: 'chat-001',
        broadcasterId: channel.platformChannelId,
      }),
    );
  });

  it('直播結束 → 呼叫 onStreamOffline', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const onOffline = vi.fn().mockResolvedValue(undefined);
    const service = new TriggerService(DEFAULT_CONFIG, onOnline, onOffline);

    const channel = makeYoutubeChannel('002');
    let callCount = 0;

    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // 第一次：有直播
        return {
          ok: true,
          json: async () => makeYoutubeLiveResponse('broadcast-002', channel.platformChannelId, 'chat-002'),
        };
      }
      // 第二次：沒直播
      return {
        ok: true,
        json: async () => ({ items: [] }),
      };
    });

    service.startYoutubePolling(async () => [channel]);

    // 等兩次 poll
    await new Promise(resolve => setTimeout(resolve, 350));
    service.stopYoutubePolling();

    expect(onOnline).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'youtube',
        channelId: channel.channelId,
      }),
    );
  });

  it('同一直播不重複觸發 online', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const service = new TriggerService(DEFAULT_CONFIG, onOnline, vi.fn());

    const channel = makeYoutubeChannel('003');
    // 每次 poll 都回傳同一個 broadcastId
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeYoutubeLiveResponse('broadcast-same', channel.platformChannelId, 'chat-x'),
    });

    service.startYoutubePolling(async () => [channel]);

    // 等三次 poll
    await new Promise(resolve => setTimeout(resolve, 450));
    service.stopYoutubePolling();

    // 雖然 poll 了多次，onOnline 只呼叫一次（狀態相同）
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it('API 回傳錯誤時不拋出（靜默 warn）', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const service = new TriggerService(DEFAULT_CONFIG, onOnline, vi.fn());

    const channel = makeYoutubeChannel('004');
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    // 不應該 throw
    service.startYoutubePolling(async () => [channel]);
    await new Promise(resolve => setTimeout(resolve, 250));
    service.stopYoutubePolling();

    expect(onOnline).not.toHaveBeenCalled();
  });

  it('stopYoutubePolling 後停止 poll', async () => {
    const onOnline = vi.fn().mockResolvedValue(undefined);
    const service = new TriggerService(DEFAULT_CONFIG, onOnline, vi.fn());

    const channel = makeYoutubeChannel('005');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeYoutubeLiveResponse('broadcast-stop', channel.platformChannelId, 'chat-stop'),
    });

    service.startYoutubePolling(async () => [channel]);
    await new Promise(resolve => setTimeout(resolve, 150));
    service.stopYoutubePolling();

    const callCountAfterStop = mockFetch.mock.calls.length;

    // 再等久一點，不應該繼續 poll
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(mockFetch.mock.calls.length).toBe(callCountAfterStop);
  });
});
