/**
 * auth-routes.test.ts — OAuth 路由整合測試
 *
 * 使用：
 *   - Fastify .inject() 模擬 HTTP 請求
 *   - vi.fn() mock global.fetch（外部 API）
 *   - 真實 PostgreSQL 連線（postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter）
 *   - 測試前清空 users / channels 表
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@cmm/db/schema';
import { authRoutes } from '../src/routes/auth.js';
import { JWTService } from '../src/auth/jwt.js';
import { decrypt } from '../src/auth/crypto.js';

// ── 測試環境常數 ──────────────────────────────────────────────────────────────

const DB_URL         = 'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter';
const ENCRYPTION_KEY = 'test-encryption-key-for-testing!!';
const JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';

// ── 模擬 config（authRoutes 內 import config 的回傳值）──────────────────────
vi.mock('../src/config.js', () => ({
  config: {
    twitch: {
      clientId:    'test_twitch_client_id',
      clientSecret:'test_twitch_client_secret',
      redirectUri: 'http://localhost:3000/auth/twitch/callback',
    },
    youtube: {
      clientId:    'test_youtube_client_id',
      clientSecret:'test_youtube_client_secret',
      redirectUri: 'http://localhost:3000/auth/youtube/callback',
    },
    cors: {
      origin: 'http://localhost:5173',
    },
  },
}));

// ── 測試輔助：建立假的 Twitch token 回應 ─────────────────────────────────────

function makeTwitchTokenResponse() {
  return {
    access_token:  'twitch_fake_access_token',
    refresh_token: 'twitch_fake_refresh_token',
    expires_in:    14400,
    token_type:    'bearer',
  };
}

function makeTwitchUserResponse(overrides?: Partial<{
  id: string;
  login: string;
  display_name: string;
  email: string;
  profile_image_url: string;
}>) {
  return {
    data: [{
      id:                '123456789',
      login:             'teststreamer',
      display_name:      'TestStreamer',
      email:             'test@example.com',
      profile_image_url: 'https://example.com/avatar.jpg',
      ...overrides,
    }],
  };
}

function makeYouTubeTokenResponse() {
  // id_token payload: { email: 'ytuser@example.com' }
  const payload = Buffer.from(JSON.stringify({ email: 'ytuser@example.com' })).toString('base64url');
  return {
    access_token:  'youtube_fake_access_token',
    refresh_token: 'youtube_fake_refresh_token',
    expires_in:    3599,
    id_token:      `header.${payload}.signature`,
  };
}

function makeYouTubeChannelResponse() {
  return {
    items: [{
      id: 'UCtest123',
      snippet: {
        title:     'My YouTube Channel',
        customUrl: '@mytestchannel',
        thumbnails: {
          default: { url: 'https://example.com/yt-avatar.jpg' },
        },
      },
    }],
  };
}

// ── DB / Fastify 設定 ─────────────────────────────────────────────────────────

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: ReturnType<typeof Fastify>;
let jwtService: JWTService;

beforeAll(async () => {
  // 建立 PG 連線池
  pool = new pg.Pool({ connectionString: DB_URL });
  db   = drizzle(pool, { schema });

  jwtService = new JWTService({
    secret:              JWT_SECRET,
    accessTokenExpiry:   '15m',
    refreshTokenExpiry:  '7d',
  });

  // 建立 Fastify 實例並掛載 cookie plugin + 路由
  app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await authRoutes(app, { jwt: jwtService, db, encryptionKey: ENCRYPTION_KEY });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  // 測試前清空資料表（注意 FK：先刪 channels，再刪 users；
  // 但 channels 有 ON DELETE CASCADE，所以直接刪 users 即可）
  await db.delete(schema.channels);
  await db.delete(schema.users);

  // 重置 fetch mock
  vi.restoreAllMocks();
});

// ── 測試區塊 ──────────────────────────────────────────────────────────────────

describe('GET /auth/twitch', () => {
  it('應重定向到 Twitch OAuth 授權頁，帶有正確 query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/auth/twitch',
    });

    expect(res.statusCode).toBe(302);

    const location = res.headers.location as string;
    expect(location).toMatch(/^https:\/\/id\.twitch\.tv\/oauth2\/authorize/);

    const url    = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('test_twitch_client_id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/twitch/callback',
    );
    expect(url.searchParams.get('scope')).toBe('user:read:email chat:read');
    // state 應為 UUID 格式
    expect(url.searchParams.get('state')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('GET /auth/twitch/callback', () => {
  it('沒有 code 時應回傳 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/auth/twitch/callback',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('code') });
  });

  it('有 error param 時應回傳 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/auth/twitch/callback?error=access_denied',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Twitch OAuth 拒絕');
  });

  it('完整流程：upsert user/channel、設定 cookie、重定向 dashboard', async () => {
    // Mock fetch：第一次回 token，第二次回 user
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchTokenResponse()))
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchUserResponse()));

    const res = await app.inject({
      method: 'GET',
      url:    '/auth/twitch/callback?code=fake_auth_code',
    });

    // 應重定向到 dashboard
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/dashboard');

    // 應設定 access_token 和 refresh_token cookies
    const cookies = res.cookies;
    const accessCookie  = cookies.find(c => c.name === 'access_token');
    const refreshCookie = cookies.find(c => c.name === 'refresh_token');

    expect(accessCookie).toBeDefined();
    expect(accessCookie?.httpOnly).toBe(true);
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);

    // 驗證 JWT 內容
    const accessPayload = await jwtService.verifyAccessToken(accessCookie!.value);
    expect(accessPayload.provider).toBe('twitch');
    expect(accessPayload.username).toBe('teststreamer');
    expect(accessPayload.userId).toBeDefined();

    // 確認 DB 有 user
    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('teststreamer');
    expect(users[0].provider).toBe('twitch');
    expect(users[0].providerId).toBe('123456789');
    // access token 應已加密
    expect(users[0].accessToken).not.toBe('twitch_fake_access_token');
    // 可解密回原始值
    expect(decrypt(users[0].accessToken, ENCRYPTION_KEY)).toBe('twitch_fake_access_token');

    // 確認 DB 有 channel
    const channels = await db.select().from(schema.channels);
    expect(channels).toHaveLength(1);
    expect(channels[0].platform).toBe('twitch');
    expect(channels[0].channelName).toBe('teststreamer');
  });

  it('同一 Twitch 使用者再次登入應 upsert（不重複建立）', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeFetchResponse(makeTwitchTokenResponse()));

    // 第一次
    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchTokenResponse()))
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchUserResponse()));
    await app.inject({ method: 'GET', url: '/auth/twitch/callback?code=code1' });

    // 第二次（display_name 改變）
    fetchMock
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchTokenResponse()))
      .mockResolvedValueOnce(makeFetchResponse(makeTwitchUserResponse({ display_name: 'NewName' })));
    await app.inject({ method: 'GET', url: '/auth/twitch/callback?code=code2' });

    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0].displayName).toBe('NewName');

    const channels = await db.select().from(schema.channels);
    expect(channels).toHaveLength(1);
  });

  it('Twitch token 交換失敗時應回傳 400', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeFetchResponse({ error: 'invalid_grant' }));

    const res = await app.inject({
      method: 'GET',
      url:    '/auth/twitch/callback?code=bad_code',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Token 交換失敗');
  });
});

describe('GET /auth/youtube', () => {
  it('應重定向到 Google OAuth 授權頁，帶有正確 query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/auth/youtube',
    });

    expect(res.statusCode).toBe(302);

    const location = res.headers.location as string;
    expect(location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);

    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('test_youtube_client_id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('youtube.readonly');
  });
});

describe('GET /auth/youtube/callback', () => {
  it('完整流程：upsert user/channel、設定 cookie、重定向 dashboard', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeFetchResponse(makeYouTubeTokenResponse()))
      .mockResolvedValueOnce(makeFetchResponse(makeYouTubeChannelResponse()));

    const res = await app.inject({
      method: 'GET',
      url:    '/auth/youtube/callback?code=yt_fake_code',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/dashboard');

    const cookies     = res.cookies;
    const accessCookie = cookies.find(c => c.name === 'access_token');
    expect(accessCookie).toBeDefined();

    const accessPayload = await jwtService.verifyAccessToken(accessCookie!.value);
    expect(accessPayload.provider).toBe('youtube');
    expect(accessPayload.username).toBe('mytestchannel');

    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0].provider).toBe('youtube');
    expect(users[0].email).toBe('ytuser@example.com');
    // 確認 token 加密
    expect(decrypt(users[0].accessToken, ENCRYPTION_KEY)).toBe('youtube_fake_access_token');

    const channels = await db.select().from(schema.channels);
    expect(channels).toHaveLength(1);
    expect(channels[0].platform).toBe('youtube');
    expect(channels[0].channelName).toBe('My YouTube Channel');
  });

  it('沒有 code 時應回傳 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/youtube/callback' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  it('沒有 refresh_token cookie 時應回傳 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });

  it('refresh_token 無效時應回傳 401', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/auth/refresh',
      cookies: { refresh_token: 'totally.invalid.token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('Refresh token 無效');
  });

  it('有效 refresh_token 時應回傳新 access_token', async () => {
    // 先建立一個真實使用者
    const [user] = await db
      .insert(schema.users)
      .values({
        provider:    'twitch',
        providerId:  'refresh_test_user',
        username:    'refreshtester',
        accessToken: 'placeholder',
        displayName: 'Refresh Tester',
      })
      .returning();

    const refreshToken = await jwtService.signRefreshToken({
      userId:   user.id,
      provider: 'twitch',
      username: 'refreshtester',
    });

    const res = await app.inject({
      method:  'POST',
      url:     '/auth/refresh',
      cookies: { refresh_token: refreshToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // 應設定新的 access_token cookie
    const newAccessCookie = res.cookies.find(c => c.name === 'access_token');
    expect(newAccessCookie).toBeDefined();

    const newPayload = await jwtService.verifyAccessToken(newAccessCookie!.value);
    expect(newPayload.userId).toBe(user.id);
    expect(newPayload.username).toBe('refreshtester');
  });

  it('使用者已被刪除時 refresh 應回傳 401', async () => {
    const refreshToken = await jwtService.signRefreshToken({
      userId:   '00000000-0000-0000-0000-000000000000',
      provider: 'twitch',
      username: 'ghost',
    });

    const res = await app.inject({
      method:  'POST',
      url:     '/auth/refresh',
      cookies: { refresh_token: refreshToken },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('使用者不存在');
  });
});

describe('POST /auth/logout', () => {
  it('應清除 cookies 並回傳 ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // 確認 cookies 被清除（maxAge=0 或 expires 過去）
    const cookies = res.cookies;
    const accessCookie  = cookies.find(c => c.name === 'access_token');
    const refreshCookie = cookies.find(c => c.name === 'refresh_token');

    // clearCookie 會把 cookie 的值設為空字串，maxAge=0
    if (accessCookie)  expect(accessCookie.maxAge).toBe(0);
    if (refreshCookie) expect(refreshCookie.maxAge).toBe(0);
  });
});

describe('GET /api/me', () => {
  it('沒有 access_token 時應回傳 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('無效 access_token 時應回傳 401', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/me',
      cookies: { access_token: 'invalid.token.here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('有效 access_token 時應回傳 user + channels', async () => {
    // 先建立使用者和頻道
    const [user] = await db
      .insert(schema.users)
      .values({
        provider:    'twitch',
        providerId:  'me_test_user',
        username:    'metester',
        displayName: 'Me Tester',
        email:       'me@example.com',
        accessToken: 'placeholder',
      })
      .returning();

    await db.insert(schema.channels).values({
      userId:      user.id,
      platform:    'twitch',
      channelId:   'me_test_user',
      channelName: 'metester',
    });

    const accessToken = await jwtService.signAccessToken({
      userId:   user.id,
      provider: 'twitch',
      username: 'metester',
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/me',
      cookies: { access_token: accessToken },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.user.id).toBe(user.id);
    expect(body.user.username).toBe('metester');
    expect(body.user.email).toBe('me@example.com');
    // accessToken 不應洩漏到 /api/me 回應
    expect(body.user.accessToken).toBeUndefined();
    expect(body.channels).toHaveLength(1);
    expect(body.channels[0].platform).toBe('twitch');
  });

  it('使用者不存在時應回傳 404', async () => {
    const accessToken = await jwtService.signAccessToken({
      userId:   '00000000-0000-0000-0000-000000000000',
      provider: 'twitch',
      username: 'ghost',
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/me',
      cookies: { access_token: accessToken },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/me', () => {
  it('沒有 access_token 時應回傳 401', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('應刪除使用者並清除 cookies', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        provider:    'twitch',
        providerId:  'delete_test_user',
        username:    'deleteme',
        accessToken: 'placeholder',
      })
      .returning();

    const accessToken = await jwtService.signAccessToken({
      userId:   user.id,
      provider: 'twitch',
      username: 'deleteme',
    });

    const res = await app.inject({
      method:  'DELETE',
      url:     '/api/me',
      cookies: { access_token: accessToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deleted: user.id });

    // 確認 DB 已刪除
    const remaining = await db
      .select()
      .from(schema.users)
      .where(schema.users.id === user.id as any);
    expect(remaining).toHaveLength(0);

    // Cookies 應被清除
    const accessCookie = res.cookies.find(c => c.name === 'access_token');
    if (accessCookie) expect(accessCookie.maxAge).toBe(0);
  });
});

// ── 測試輔助函式 ──────────────────────────────────────────────────────────────

/**
 * 製造一個 Response-like 物件讓 vi.spyOn fetch mock 使用
 */
function makeFetchResponse(data: unknown, status = 200): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => data,
    text:   async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response;
}
