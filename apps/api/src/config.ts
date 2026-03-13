import dotenv from 'dotenv';
dotenv.config();

// ── Config Interface ─────────────────────────────────────────────
export interface Config {
  port: number;
  host: string;
  database: { url: string };
  redis: { url: string };
  jwt: { secret: string; accessExpiresIn: string; refreshExpiresIn: string };
  oauth: {
    twitch: { clientId: string; clientSecret: string; redirectUri: string };
    youtube: { clientId: string; clientSecret: string; redirectUri: string };
  };
  encryption: { key: string };
  cors: { origin: string };
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    database: {
      url: process.env.DATABASE_URL || '',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
    },
    oauth: {
      twitch: {
        clientId: process.env.TWITCH_CLIENT_ID || '',
        clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
        redirectUri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3000/auth/twitch/callback',
      },
      youtube: {
        clientId: process.env.YOUTUBE_CLIENT_ID || '',
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
        redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback',
      },
    },
    encryption: {
      key: process.env.ENCRYPTION_KEY || 'dev-encryption-key-change-in-prod',
    },
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    },
  };
}

// ── Legacy flat export（保持向下相容）────────────────────────────
const _cfg = loadConfig();

export const config = {
  port: _cfg.port,
  host: _cfg.host,
  database: _cfg.database,
  redis: _cfg.redis,
  jwt: {
    secret: _cfg.jwt.secret,
    accessTokenExpiry: _cfg.jwt.accessExpiresIn,
    refreshTokenExpiry: _cfg.jwt.refreshExpiresIn,
  },
  encryption: _cfg.encryption,
  twitch: _cfg.oauth.twitch,
  youtube: _cfg.oauth.youtube,
  cors: _cfg.cors,
};
