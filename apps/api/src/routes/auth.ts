/**
 * auth.ts — OAuth 路由（Twitch + YouTube）
 *
 * 路由列表：
 *   GET  /auth/twitch            → 重定向到 Twitch OAuth 授權頁
 *   GET  /auth/twitch/callback   → 處理 Twitch callback，發 JWT cookie
 *   GET  /auth/youtube           → 重定向到 Google OAuth 授權頁
 *   GET  /auth/youtube/callback  → 處理 YouTube callback，發 JWT cookie
 *   POST /auth/refresh           → 用 refresh token 換新 access token
 *   POST /auth/logout            → 清除 cookies
 *   GET  /api/me                 → 取得當前使用者資訊
 *   DELETE /api/me               → 刪除帳號
 */

import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@cmm/db/schema';
import { config } from '../config.js';
import { encrypt } from '../auth/crypto.js';
import type { JWTService } from '../auth/jwt.js';

// ── 型別 ──────────────────────────────────────────────────────────────────────

type DrizzleDB = NodePgDatabase<typeof schema>;

interface AuthDeps {
  jwt: JWTService;
  db: DrizzleDB;
  encryptionKey: string;
}

// ── OAuth 常數 ────────────────────────────────────────────────────────────────

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

// ── Cookie 設定 ───────────────────────────────────────────────────────────────

const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 15 * 60, // 15 分鐘
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/auth/refresh',
  maxAge: 7 * 24 * 60 * 60, // 7 天
};

// ── 主路由 ────────────────────────────────────────────────────────────────────

export async function authRoutes(
  app: FastifyInstance,
  deps: AuthDeps,
): Promise<void> {
  const { jwt, db, encryptionKey } = deps;

  // ── GET /auth/twitch ─────────────────────────────────────────────────────────
  app.get('/auth/twitch', async (_request, reply) => {
    const params = new URLSearchParams({
      client_id:     config.twitch.clientId,
      redirect_uri:  config.twitch.redirectUri,
      response_type: 'code',
      scope:         'user:read:email chat:read',
      state:         crypto.randomUUID(), // CSRF protection
    });
    return reply.redirect(`${TWITCH_AUTH_URL}?${params}`);
  });

  // ── GET /auth/twitch/callback ────────────────────────────────────────────────
  app.get('/auth/twitch/callback', async (request, reply) => {
    const { code, error } = request.query as { code?: string; error?: string };

    if (error) {
      return reply.status(400).send({ error: `Twitch OAuth 拒絕：${error}` });
    }
    if (!code) {
      return reply.status(400).send({ error: '缺少 authorization code' });
    }

    // 1. 用 code 換 access_token
    const tokenRes = await fetch(TWITCH_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  config.twitch.redirectUri,
      }),
    });
    const tokenData = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokenData.access_token) {
      return reply.status(400).send({ error: 'Token 交換失敗' });
    }

    // 2. 取 user profile
    const userRes = await fetch(TWITCH_USERS_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id':   config.twitch.clientId,
      },
    });
    const userData = await userRes.json() as {
      data?: Array<{
        id: string;
        login: string;
        display_name: string;
        email?: string;
        profile_image_url?: string;
      }>;
    };
    const twitchUser = userData.data?.[0];
    if (!twitchUser) {
      return reply.status(400).send({ error: '無法取得使用者資料' });
    }

    // 3. 計算 token 過期時間
    const tokenExpires = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // 4. Upsert user（INSERT ... ON CONFLICT DO UPDATE）
    const [user] = await db
      .insert(schema.users)
      .values({
        provider:     'twitch',
        providerId:   twitchUser.id,
        username:     twitchUser.login,
        displayName:  twitchUser.display_name,
        email:        twitchUser.email ?? null,
        avatarUrl:    twitchUser.profile_image_url ?? null,
        accessToken:  encrypt(tokenData.access_token, encryptionKey),
        refreshToken: tokenData.refresh_token
          ? encrypt(tokenData.refresh_token, encryptionKey)
          : null,
        tokenExpires,
        updatedAt:    new Date(),
      })
      .onConflictDoUpdate({
        target:       [schema.users.provider, schema.users.providerId],
        set: {
          username:     twitchUser.login,
          displayName:  twitchUser.display_name,
          email:        twitchUser.email ?? null,
          avatarUrl:    twitchUser.profile_image_url ?? null,
          accessToken:  encrypt(tokenData.access_token, encryptionKey),
          refreshToken: tokenData.refresh_token
            ? encrypt(tokenData.refresh_token, encryptionKey)
            : null,
          tokenExpires,
          updatedAt:    new Date(),
        },
      })
      .returning();

    // 5. Upsert channel（使用者自己的頻道）
    await db
      .insert(schema.channels)
      .values({
        userId:      user.id,
        platform:    'twitch',
        channelId:   twitchUser.id,
        channelName: twitchUser.login,
        enabled:     true,
        autoStart:   true,
      })
      .onConflictDoUpdate({
        target: [schema.channels.userId, schema.channels.platform, schema.channels.channelId],
        set: {
          channelName: twitchUser.login,
          enabled:     true,
        },
      });

    // 6. 簽發 JWT
    const payload = { userId: user.id, provider: 'twitch' as const, username: user.username };
    const accessToken  = await jwt.signAccessToken(payload);
    const refreshToken = await jwt.signRefreshToken(payload);

    reply
      .setCookie('access_token',  accessToken,  ACCESS_COOKIE_OPTS)
      .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS);

    return reply.redirect(`${config.cors.origin}/dashboard`);
  });

  // ── GET /auth/youtube ────────────────────────────────────────────────────────
  app.get('/auth/youtube', async (_request, reply) => {
    const params = new URLSearchParams({
      client_id:     config.youtube.clientId,
      redirect_uri:  config.youtube.redirectUri,
      response_type: 'code',
      scope:         'https://www.googleapis.com/auth/youtube.readonly openid email profile',
      access_type:   'offline',    // 取得 refresh token
      prompt:        'consent',    // 強制再次同意，確保拿到 refresh_token
      state:         crypto.randomUUID(),
    });
    return reply.redirect(`${YOUTUBE_AUTH_URL}?${params}`);
  });

  // ── GET /auth/youtube/callback ───────────────────────────────────────────────
  app.get('/auth/youtube/callback', async (request, reply) => {
    const { code, error } = request.query as { code?: string; error?: string };

    if (error) {
      return reply.status(400).send({ error: `Google OAuth 拒絕：${error}` });
    }
    if (!code) {
      return reply.status(400).send({ error: '缺少 authorization code' });
    }

    // 1. 用 code 換 tokens
    const tokenRes = await fetch(YOUTUBE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     config.youtube.clientId,
        client_secret: config.youtube.clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  config.youtube.redirectUri,
      }),
    });
    const tokenData = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };
    if (!tokenData.access_token) {
      return reply.status(400).send({ error: 'Token 交換失敗' });
    }

    // 2. 取 YouTube channel 資訊
    const channelRes = await fetch(
      `${YOUTUBE_CHANNELS_URL}?part=snippet&mine=true`,
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );
    const channelData = await channelRes.json() as {
      items?: Array<{
        id: string;
        snippet: {
          title: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
      }>;
    };
    const ytChannel = channelData.items?.[0];
    if (!ytChannel) {
      return reply.status(400).send({ error: '無法取得 YouTube 頻道資料' });
    }

    // 3. 解析 id_token 取 email（Google id_token 是 JWT，直接 base64 解析 payload）
    let email: string | null = null;
    if (tokenData.id_token) {
      try {
        const payloadB64 = tokenData.id_token.split('.')[1];
        if (payloadB64) {
          const decoded = JSON.parse(
            Buffer.from(payloadB64, 'base64url').toString('utf8'),
          ) as { email?: string };
          email = decoded.email ?? null;
        }
      } catch {
        // id_token 解析失敗不影響主流程
      }
    }

    const tokenExpires = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    const username = ytChannel.snippet.customUrl?.replace('@', '') ?? ytChannel.id;
    const avatarUrl = ytChannel.snippet.thumbnails?.default?.url ?? null;

    // 4. Upsert user
    const [user] = await db
      .insert(schema.users)
      .values({
        provider:     'youtube',
        providerId:   ytChannel.id,
        username,
        displayName:  ytChannel.snippet.title,
        email,
        avatarUrl,
        accessToken:  encrypt(tokenData.access_token, encryptionKey),
        refreshToken: tokenData.refresh_token
          ? encrypt(tokenData.refresh_token, encryptionKey)
          : null,
        tokenExpires,
        updatedAt:    new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.users.provider, schema.users.providerId],
        set: {
          username,
          displayName:  ytChannel.snippet.title,
          email,
          avatarUrl,
          accessToken:  encrypt(tokenData.access_token, encryptionKey),
          refreshToken: tokenData.refresh_token
            ? encrypt(tokenData.refresh_token, encryptionKey)
            : null,
          tokenExpires,
          updatedAt:    new Date(),
        },
      })
      .returning();

    // 5. Upsert channel
    await db
      .insert(schema.channels)
      .values({
        userId:      user.id,
        platform:    'youtube',
        channelId:   ytChannel.id,
        channelName: ytChannel.snippet.title,
        enabled:     true,
        autoStart:   true,
      })
      .onConflictDoUpdate({
        target: [schema.channels.userId, schema.channels.platform, schema.channels.channelId],
        set: {
          channelName: ytChannel.snippet.title,
          enabled:     true,
        },
      });

    // 6. 簽發 JWT
    const payload = { userId: user.id, provider: 'youtube' as const, username: user.username };
    const accessToken  = await jwt.signAccessToken(payload);
    const refreshToken = await jwt.signRefreshToken(payload);

    reply
      .setCookie('access_token',  accessToken,  ACCESS_COOKIE_OPTS)
      .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS);

    return reply.redirect(`${config.cors.origin}/dashboard`);
  });

  // ── POST /auth/refresh ───────────────────────────────────────────────────────
  // 從 cookie 讀 refresh_token，驗證後換發新的 access_token
  app.post('/auth/refresh', async (request, reply) => {
    const token = (request.cookies as Record<string, string | undefined>)['refresh_token'];
    if (!token) {
      return reply.status(401).send({ error: '未提供 refresh token' });
    }

    let payload: { userId: string; provider: 'twitch' | 'youtube'; username: string };
    try {
      payload = await jwt.verifyRefreshToken(token);
    } catch {
      return reply
        .clearCookie('refresh_token', { path: '/auth/refresh' })
        .status(401)
        .send({ error: 'Refresh token 無效或已過期' });
    }

    // 確認使用者仍存在於 DB
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, payload.userId))
      .limit(1);

    if (!user) {
      return reply
        .clearCookie('access_token',  { path: '/' })
        .clearCookie('refresh_token', { path: '/auth/refresh' })
        .status(401)
        .send({ error: '使用者不存在' });
    }

    const accessToken = await jwt.signAccessToken({
      userId:   user.id,
      provider: user.provider as 'twitch' | 'youtube',
      username: user.username,
    });

    reply.setCookie('access_token', accessToken, ACCESS_COOKIE_OPTS);

    return reply.send({ ok: true });
  });

  // ── POST /auth/logout ────────────────────────────────────────────────────────
  app.post('/auth/logout', async (_request, reply) => {
    reply
      .clearCookie('access_token',  { path: '/' })
      .clearCookie('refresh_token', { path: '/auth/refresh' });
    return reply.send({ ok: true });
  });

  // ── GET /api/me ──────────────────────────────────────────────────────────────
  // 需要有效的 access_token cookie
  app.get('/api/me', async (request, reply) => {
    const token = (request.cookies as Record<string, string | undefined>)['access_token'];
    if (!token) {
      return reply.status(401).send({ error: '未登入' });
    }

    let payload: { userId: string; provider: 'twitch' | 'youtube'; username: string };
    try {
      payload = await jwt.verifyAccessToken(token);
    } catch {
      return reply.status(401).send({ error: 'Access token 無效或已過期' });
    }

    const [user] = await db
      .select({
        id:          schema.users.id,
        provider:    schema.users.provider,
        username:    schema.users.username,
        displayName: schema.users.displayName,
        email:       schema.users.email,
        avatarUrl:   schema.users.avatarUrl,
        createdAt:   schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, payload.userId))
      .limit(1);

    if (!user) {
      return reply.status(404).send({ error: '使用者不存在' });
    }

    // 同時回傳該使用者的 channels
    const channels = await db
      .select({
        id:           schema.channels.id,
        platform:     schema.channels.platform,
        channelId:    schema.channels.channelId,
        channelName:  schema.channels.channelName,
        enabled:      schema.channels.enabled,
        autoStart:    schema.channels.autoStart,
        analyzerMode: schema.channels.analyzerMode,
      })
      .from(schema.channels)
      .where(eq(schema.channels.userId, user.id));

    return reply.send({ user, channels });
  });

  // ── DELETE /api/me ───────────────────────────────────────────────────────────
  // 刪除帳號（cascade 會一併刪除 channels / sessions / snapshots / highlights）
  app.delete('/api/me', async (request, reply) => {
    const token = (request.cookies as Record<string, string | undefined>)['access_token'];
    if (!token) {
      return reply.status(401).send({ error: '未登入' });
    }

    let payload: { userId: string; provider: 'twitch' | 'youtube'; username: string };
    try {
      payload = await jwt.verifyAccessToken(token);
    } catch {
      return reply.status(401).send({ error: 'Access token 無效或已過期' });
    }

    const deleted = await db
      .delete(schema.users)
      .where(eq(schema.users.id, payload.userId))
      .returning({ id: schema.users.id });

    if (deleted.length === 0) {
      return reply.status(404).send({ error: '使用者不存在' });
    }

    reply
      .clearCookie('access_token',  { path: '/' })
      .clearCookie('refresh_token', { path: '/auth/refresh' });

    return reply.send({ ok: true, deleted: deleted[0].id });
  });
}
