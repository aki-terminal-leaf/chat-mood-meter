import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { JWTService } from '../src/auth/jwt.js';
import type { TokenPayload } from '../src/auth/jwt.js';

describe('JWTService', () => {
  let jwtService: JWTService;

  const samplePayload: TokenPayload = {
    userId: 'user-123',
    provider: 'twitch',
    username: 'streamer_aki',
  };

  beforeEach(() => {
    jwtService = new JWTService({
      secret: 'test-jwt-secret-for-unit-tests',
      accessTokenExpiry: '15m',
      refreshTokenExpiry: '7d',
    });
  });

  // ── Access Token ────────────────────────────────────────────────────
  describe('Access Token', () => {
    it('sign → verify 成功，payload 應完整還原', async () => {
      const token = await jwtService.signAccessToken(samplePayload);
      const result = await jwtService.verifyAccessToken(token);

      expect(result.userId).toBe(samplePayload.userId);
      expect(result.provider).toBe(samplePayload.provider);
      expect(result.username).toBe(samplePayload.username);
    });

    it('Access Token 的 type claim 應為 "access"', async () => {
      const token = await jwtService.signAccessToken(samplePayload);
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode('test-jwt-secret-for-unit-tests'),
      );
      expect((payload as Record<string, unknown>).type).toBe('access');
    });

    it('用 verifyRefreshToken 驗證 Access Token，應拋出錯誤', async () => {
      const token = await jwtService.signAccessToken(samplePayload);
      await expect(jwtService.verifyRefreshToken(token)).rejects.toThrow();
    });

    it('YouTube provider 的 Access Token 也能正確處理', async () => {
      const ytPayload: TokenPayload = { ...samplePayload, provider: 'youtube' };
      const token = await jwtService.signAccessToken(ytPayload);
      const result = await jwtService.verifyAccessToken(token);
      expect(result.provider).toBe('youtube');
    });
  });

  // ── Refresh Token ───────────────────────────────────────────────────
  describe('Refresh Token', () => {
    it('sign → verify 成功，payload 應完整還原', async () => {
      const token = await jwtService.signRefreshToken(samplePayload);
      const result = await jwtService.verifyRefreshToken(token);

      expect(result.userId).toBe(samplePayload.userId);
      expect(result.provider).toBe(samplePayload.provider);
      expect(result.username).toBe(samplePayload.username);
    });

    it('Refresh Token 的 type claim 應為 "refresh"', async () => {
      const token = await jwtService.signRefreshToken(samplePayload);
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode('test-jwt-secret-for-unit-tests'),
      );
      expect((payload as Record<string, unknown>).type).toBe('refresh');
    });

    it('用 verifyAccessToken 驗證 Refresh Token，應拋出錯誤', async () => {
      const token = await jwtService.signRefreshToken(samplePayload);
      await expect(jwtService.verifyAccessToken(token)).rejects.toThrow();
    });
  });

  // ── Access vs Refresh 差異 ──────────────────────────────────────────
  describe('Access Token 與 Refresh Token 的差異', () => {
    it('兩種 token 的 type claim 應不同', async () => {
      const accessToken = await jwtService.signAccessToken(samplePayload);
      const refreshToken = await jwtService.signRefreshToken(samplePayload);
      const secretKey = new TextEncoder().encode('test-jwt-secret-for-unit-tests');

      const { payload: ap } = await jose.jwtVerify(accessToken, secretKey);
      const { payload: rp } = await jose.jwtVerify(refreshToken, secretKey);

      expect((ap as Record<string, unknown>).type).toBe('access');
      expect((rp as Record<string, unknown>).type).toBe('refresh');
      expect((ap as Record<string, unknown>).type).not.toBe((rp as Record<string, unknown>).type);
    });
  });

  // ── 過期 Token ──────────────────────────────────────────────────────
  describe('過期 Token', () => {
    it('過期的 Access Token 驗證應拋出錯誤', async () => {
      // 直接用 jose 簽一個已經過期（exp 設在過去）的 token
      const secret = new TextEncoder().encode('test-jwt-secret-for-unit-tests');
      const expiredToken = await new jose.SignJWT({
        userId: samplePayload.userId,
        provider: samplePayload.provider,
        username: samplePayload.username,
        type: 'access',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(new Date(Date.now() - 60_000))
        .setExpirationTime(new Date(Date.now() - 30_000)) // 30 秒前就到期
        .sign(secret);

      await expect(jwtService.verifyAccessToken(expiredToken)).rejects.toThrow();
    });

    it('過期的 Refresh Token 驗證應拋出錯誤', async () => {
      const secret = new TextEncoder().encode('test-jwt-secret-for-unit-tests');
      const expiredToken = await new jose.SignJWT({
        userId: samplePayload.userId,
        provider: samplePayload.provider,
        username: samplePayload.username,
        type: 'refresh',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(new Date(Date.now() - 60_000))
        .setExpirationTime(new Date(Date.now() - 30_000))
        .sign(secret);

      await expect(jwtService.verifyRefreshToken(expiredToken)).rejects.toThrow();
    });
  });

  // ── 無效 Token ──────────────────────────────────────────────────────
  describe('無效 Token', () => {
    it('完全偽造的字串，驗證應拋出錯誤', async () => {
      await expect(jwtService.verifyAccessToken('not.a.valid.jwt')).rejects.toThrow();
    });

    it('空字串，驗證應拋出錯誤', async () => {
      await expect(jwtService.verifyAccessToken('')).rejects.toThrow();
    });

    it('用不同 secret 簽發的 token，驗證應拋出錯誤', async () => {
      const otherService = new JWTService({ secret: 'totally-different-secret' });
      const token = await otherService.signAccessToken(samplePayload);

      await expect(jwtService.verifyAccessToken(token)).rejects.toThrow();
    });

    it('竄改後的 token，驗證應拋出錯誤', async () => {
      const token = await jwtService.signAccessToken(samplePayload);
      // 在 payload 段（第二段）末尾加上垃圾字元
      const parts = token.split('.');
      parts[1] = parts[1] + 'tampered';
      const tampered = parts.join('.');

      await expect(jwtService.verifyAccessToken(tampered)).rejects.toThrow();
    });
  });
});
