import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JWTService } from '../auth/jwt.js';

// 擴展 FastifyRequest，加上解析後的 user 資訊
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      provider: string;
      username: string;
    };
  }
}

/**
 * 建立 Auth Middleware（preHandler hook 用）
 *
 * Token 來源優先順序：
 * 1. Authorization: Bearer <token>
 * 2. Cookie: access_token
 */
export function createAuthMiddleware(jwt: JWTService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // @fastify/cookie 會把 cookies 掛在 request.cookies
      token = (request.cookies as Record<string, string> | undefined)?.access_token;
    }

    if (!token) {
      await reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    try {
      const payload = await jwt.verifyAccessToken(token);
      request.user = payload;
    } catch {
      await reply.status(401).send({ error: 'Invalid token' });
    }
  };
}
