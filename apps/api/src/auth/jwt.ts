import * as jose from 'jose';

export interface TokenPayload {
  userId: string;
  provider: 'twitch' | 'youtube';
  username: string;
}

export interface JWTConfig {
  secret: string;
  accessTokenExpiry?: string;  // 預設 '15m'
  refreshTokenExpiry?: string; // 預設 '7d'
}

/** JWT claims 的內部結構（jose 解析後） */
interface InternalClaims extends jose.JWTPayload {
  userId: string;
  provider: 'twitch' | 'youtube';
  username: string;
  type: 'access' | 'refresh';
}

export class JWTService {
  private secret: Uint8Array;
  private accessExpiry: string;
  private refreshExpiry: string;

  constructor(config: JWTConfig) {
    this.secret = new TextEncoder().encode(config.secret);
    this.accessExpiry = config.accessTokenExpiry ?? '15m';
    this.refreshExpiry = config.refreshTokenExpiry ?? '7d';
  }

  /** 簽發 Access Token（短效，15m） */
  async signAccessToken(payload: TokenPayload): Promise<string> {
    return new jose.SignJWT({
      userId: payload.userId,
      provider: payload.provider,
      username: payload.username,
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.accessExpiry)
      .sign(this.secret);
  }

  /** 簽發 Refresh Token（長效，7d） */
  async signRefreshToken(payload: TokenPayload): Promise<string> {
    return new jose.SignJWT({
      userId: payload.userId,
      provider: payload.provider,
      username: payload.username,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.refreshExpiry)
      .sign(this.secret);
  }

  /** 驗證 Access Token，回傳 payload；失敗拋錯 */
  async verifyAccessToken(token: string): Promise<TokenPayload> {
    const { payload } = await jose.jwtVerify<InternalClaims>(token, this.secret);

    if (payload.type !== 'access') {
      throw new Error('不是有效的 Access Token');
    }

    return {
      userId: payload.userId,
      provider: payload.provider,
      username: payload.username,
    };
  }

  /** 驗證 Refresh Token，回傳 payload；失敗拋錯 */
  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    const { payload } = await jose.jwtVerify<InternalClaims>(token, this.secret);

    if (payload.type !== 'refresh') {
      throw new Error('不是有效的 Refresh Token');
    }

    return {
      userId: payload.userId,
      provider: payload.provider,
      username: payload.username,
    };
  }
}
