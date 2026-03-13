import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://cmm:cmm_dev_2026@localhost:5432/chatmoodmeter',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY ?? 'dev-encryption-key-change-in-prod',
  },

  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID ?? '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
    redirectUri: process.env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/auth/twitch/callback',
  },

  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
    redirectUri: process.env.YOUTUBE_REDIRECT_URI ?? 'http://localhost:3000/auth/youtube/callback',
  },

  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
};
