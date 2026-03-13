import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JWTService } from '../src/auth/jwt.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import type { TokenPayload } from '../src/auth/jwt.js';

// ── 測試輔助：模擬 FastifyRequest / FastifyReply ─────────────────────

function makeMockReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return reply;
    },
  };
  return reply;
}

type MockReply = ReturnType<typeof makeMockReply>;

function makeMockRequest(opts: {
  authHeader?: string;
  cookies?: Record<string, string>;
}) {
  return {
    headers: {
      authorization: opts.authHeader,
    },
    cookies: opts.cookies,
    user: undefined as TokenPayload | undefined,
  };
}

// ── 測試 ─────────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  let jwtService: JWTService;
  let middleware: ReturnType<typeof createAuthMiddleware>;

  const payload: TokenPayload = {
    userId: 'user-456',
    provider: 'twitch',
    username: 'aki_streamer',
  };

  beforeEach(() => {
    jwtService = new JWTService({ secret: 'middleware-test-secret' });
    middleware = createAuthMiddleware(jwtService);
  });

  // ── Authorization Header ─────────────────────────────────────────
  describe('Bearer Token（Authorization Header）', () => {
    it('有效 Bearer Token → request.user 被正確設定', async () => {
      const token = await jwtService.signAccessToken(payload);
      const request = makeMockRequest({ authHeader: `Bearer ${token}` });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(200);
      expect(request.user).toEqual(payload);
    });

    it('無效 Bearer Token → 回傳 401', async () => {
      const request = makeMockRequest({ authHeader: 'Bearer invalid.token.value' });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Invalid token' });
    });

    it('Bearer 後面沒有 token → 無法解析，回傳 401', async () => {
      // "Bearer " 後空白，不是有效的 token
      const request = makeMockRequest({ authHeader: 'Bearer ' });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      // 空白字串作為 token 會讓 jose 驗證失敗
      expect(reply.statusCode).toBe(401);
    });
  });

  // ── Cookie ───────────────────────────────────────────────────────
  describe('Cookie（access_token）', () => {
    it('有效 Cookie Token → request.user 被正確設定', async () => {
      const token = await jwtService.signAccessToken(payload);
      const request = makeMockRequest({ cookies: { access_token: token } });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(200);
      expect(request.user).toEqual(payload);
    });

    it('無效 Cookie Token → 回傳 401', async () => {
      const request = makeMockRequest({ cookies: { access_token: 'garbage' } });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Invalid token' });
    });
  });

  // ── 無 Token ─────────────────────────────────────────────────────
  describe('無 Token', () => {
    it('沒有 Authorization header 也沒有 cookie → 回傳 401', async () => {
      const request = makeMockRequest({});
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Unauthorized' });
    });

    it('Authorization header 不是 Bearer 格式 → 嘗試 cookie，沒有 cookie 則 401', async () => {
      const request = makeMockRequest({ authHeader: 'Basic dXNlcjpwYXNz' });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Unauthorized' });
    });

    it('cookies 物件存在但沒有 access_token key → 回傳 401', async () => {
      const request = makeMockRequest({ cookies: { other_cookie: 'value' } });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Unauthorized' });
    });
  });

  // ── 優先順序 ─────────────────────────────────────────────────────
  describe('Token 來源優先順序', () => {
    it('Header 和 Cookie 都有時，優先使用 Header', async () => {
      const headerToken = await jwtService.signAccessToken(payload);
      const cookiePayload: TokenPayload = { ...payload, userId: 'cookie-user' };
      const cookieToken = await jwtService.signAccessToken(cookiePayload);

      const request = makeMockRequest({
        authHeader: `Bearer ${headerToken}`,
        cookies: { access_token: cookieToken },
      });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(request.user?.userId).toBe(payload.userId); // Header 的 user
    });
  });

  // ── Refresh Token 不應被接受 ─────────────────────────────────────
  describe('Token 類型檢查', () => {
    it('使用 Refresh Token 當作 Access Token → 回傳 401', async () => {
      const refreshToken = await jwtService.signRefreshToken(payload);
      const request = makeMockRequest({ authHeader: `Bearer ${refreshToken}` });
      const reply = makeMockReply();

      await middleware(request as never, reply as never);

      expect(reply.statusCode).toBe(401);
      expect(reply.body).toEqual({ error: 'Invalid token' });
    });
  });
});
