import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export interface TriggerConfig {
  twitchClientId: string;
  twitchClientSecret: string;
  twitchWebhookSecret: string; // EventSub 驗證用
  youtubePollingIntervalMs: number; // 預設 60000
}

export interface StreamEvent {
  platform: 'twitch' | 'youtube';
  channelId: string;      // DB channel UUID
  channelName: string;
  broadcasterId: string;  // 平台 broadcaster ID
  userId: string;         // DB user UUID
  liveChatId?: string;    // YouTube 專用
}

export interface YoutubeChannel {
  channelId: string;         // DB UUID
  platformChannelId: string;
  userId: string;
  accessToken: string;       // 已解密
}

/** YouTube liveBroadcasts.list API 回應 */
interface YoutubeLiveBroadcast {
  id: string;
  snippet: {
    channelId: string;
    title: string;
    liveChatId: string;
  };
  status: {
    lifeCycleStatus: 'complete' | 'created' | 'live' | 'liveStarting' | 'ready' | 'revoked' | 'testStarting' | 'testing';
    recordingStatus: string;
  };
}

interface YoutubeApiResponse {
  items?: YoutubeLiveBroadcast[];
}

// 追蹤各 channel 的直播狀態（避免重複觸發）
type YoutubeChannelState = Map<string, string | null>; // platformChannelId → 當前 broadcastId | null

export class TriggerService {
  private youtubeTimer: NodeJS.Timeout | null = null;
  // 追蹤 YouTube 各頻道是否有進行中直播（platformChannelId → broadcastId）
  private youtubeLiveState: YoutubeChannelState = new Map();

  constructor(
    private config: TriggerConfig,
    private onStreamOnline: (event: StreamEvent) => Promise<void>,
    private onStreamOffline: (event: StreamEvent) => Promise<void>,
  ) {}

  // ── Twitch EventSub Webhook ──────────
  // 驗證 Twitch HMAC-SHA256 簽名
  private verifyTwitchSignature(
    messageId: string,
    timestamp: string,
    body: string,
    signature: string,
  ): boolean {
    const message = messageId + timestamp + body;
    const hmac = createHmac('sha256', this.config.twitchWebhookSecret)
      .update(message)
      .digest('hex');
    const expected = `sha256=${hmac}`;

    // 使用 timingSafeEqual 防止 timing attack
    try {
      return timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(signature, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  // 註冊 Fastify 路由：POST /webhooks/twitch
  registerWebhook(app: FastifyInstance): void {
    app.post('/webhooks/twitch', {
      config: { rawBody: true }, // 需要 rawBody 做簽名驗證
    }, async (request, reply) => {
      const messageId = request.headers['twitch-eventsub-message-id'] as string;
      const timestamp = request.headers['twitch-eventsub-message-timestamp'] as string;
      const signature = request.headers['twitch-eventsub-message-signature'] as string;
      const messageType = request.headers['twitch-eventsub-message-type'] as string;

      if (!messageId || !timestamp || !signature) {
        return reply.status(400).send({ error: 'Missing required Twitch headers' });
      }

      // 驗證簽名（body 需要是 raw string）
      const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
      const isValid = this.verifyTwitchSignature(messageId, timestamp, rawBody, signature);

      if (!isValid) {
        return reply.status(403).send({ error: 'Invalid signature' });
      }

      const body = request.body as Record<string, unknown>;

      // 處理 webhook_callback_verification（訂閱驗證）
      if (messageType === 'webhook_callback_verification') {
        const challenge = (body as { challenge: string }).challenge;
        return reply.status(200)
          .header('Content-Type', 'text/plain')
          .send(challenge);
      }

      // 處理 notification（實際事件）
      if (messageType === 'notification') {
        const subscriptionType = (body.subscription as { type: string })?.type;
        const event = body.event as {
          broadcaster_user_id: string;
          broadcaster_user_name: string;
          broadcaster_user_login: string;
        };

        // 從 subscription condition 取得 broadcaster_user_id
        // 這裡需要從外部查 DB 取得 channelId / userId
        // 實際整合時應注入 channel lookup function
        const streamEvent: StreamEvent = {
          platform: 'twitch',
          channelId: '', // 需由呼叫方注入 lookup
          channelName: event.broadcaster_user_login,
          broadcasterId: event.broadcaster_user_id,
          userId: '', // 需由呼叫方注入 lookup
        };

        if (subscriptionType === 'stream.online') {
          await this.onStreamOnline(streamEvent);
        } else if (subscriptionType === 'stream.offline') {
          await this.onStreamOffline(streamEvent);
        }
      }

      return reply.status(200).send({ ok: true });
    });
  }

  // ── 取得 Twitch App Access Token ──────────
  private async getTwitchAppToken(): Promise<string> {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.twitchClientId,
        client_secret: this.config.twitchClientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to get Twitch token: ${res.status}`);
    }

    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  // ── 訂閱 Twitch EventSub ──────────
  async subscribeTwitchEvents(broadcasterId: string, callbackUrl: string): Promise<void> {
    const token = await this.getTwitchAppToken();

    for (const type of ['stream.online', 'stream.offline'] as const) {
      const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
          'Client-ID': this.config.twitchClientId,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
          transport: {
            method: 'webhook',
            callback: callbackUrl,
            secret: this.config.twitchWebhookSecret,
          },
        }),
      });

      if (!res.ok && res.status !== 409) {
        // 409 = 已訂閱，忽略；其他錯誤才拋出
        const body = await res.text();
        throw new Error(`Failed to subscribe Twitch EventSub (${type}): ${res.status} ${body}`);
      }
    }
  }

  // ── YouTube Polling ──────────
  startYoutubePolling(getActiveYoutubeChannels: () => Promise<YoutubeChannel[]>): void {
    this.youtubeTimer = setInterval(async () => {
      try {
        const channels = await getActiveYoutubeChannels();

        for (const ch of channels) {
          await this.pollYoutubeChannel(ch);
        }
      } catch (err) {
        console.error('[TriggerService] YouTube polling error:', err);
      }
    }, this.config.youtubePollingIntervalMs);
  }

  private async pollYoutubeChannel(ch: YoutubeChannel): Promise<void> {
    // 查詢 YouTube Data API: liveBroadcasts.list（只取進行中的直播）
    const url = new URL('https://www.googleapis.com/youtube/v3/liveBroadcasts');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('broadcastStatus', 'active');
    url.searchParams.set('maxResults', '5');

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${ch.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[TriggerService] YouTube API error for channel ${ch.channelId}: ${res.status}`);
      return;
    }

    const data = await res.json() as YoutubeApiResponse;
    const liveItems = (data.items ?? []).filter(
      item => item.status.lifeCycleStatus === 'live',
    );

    const prevBroadcastId = this.youtubeLiveState.get(ch.platformChannelId) ?? null;

    if (liveItems.length > 0) {
      const broadcast = liveItems[0];
      // 只在狀態從「沒有直播」變成「有直播」時觸發 online
      if (prevBroadcastId !== broadcast.id) {
        this.youtubeLiveState.set(ch.platformChannelId, broadcast.id);
        await this.onStreamOnline({
          platform: 'youtube',
          channelId: ch.channelId,
          channelName: broadcast.snippet.channelId,
          broadcasterId: ch.platformChannelId,
          userId: ch.userId,
          liveChatId: broadcast.snippet.liveChatId,
        });
      }
    } else {
      // 直播結束
      if (prevBroadcastId !== null) {
        this.youtubeLiveState.set(ch.platformChannelId, null);
        await this.onStreamOffline({
          platform: 'youtube',
          channelId: ch.channelId,
          channelName: ch.platformChannelId,
          broadcasterId: ch.platformChannelId,
          userId: ch.userId,
        });
      }
    }
  }

  stopYoutubePolling(): void {
    if (this.youtubeTimer) {
      clearInterval(this.youtubeTimer);
      this.youtubeTimer = null;
    }
  }
}
