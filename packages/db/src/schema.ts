import { pgTable, uuid, text, boolean, timestamp, bigserial, real, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

// users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),         // 'twitch' | 'youtube'
  providerId: text('provider_id').notNull(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  accessToken: text('access_token').notNull(),  // AES-256-GCM encrypted
  refreshToken: text('refresh_token'),
  tokenExpires: timestamp('token_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_users_provider').on(table.provider, table.providerId),
]);

// channels table
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  channelId: text('channel_id').notNull(),
  channelName: text('channel_name').notNull(),
  enabled: boolean('enabled').default(true),
  autoStart: boolean('auto_start').default(true),
  analyzerMode: text('analyzer_mode').default('rules'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_channels_unique').on(table.userId, table.platform, table.channelId),
  index('idx_channels_user').on(table.userId),
]);

// sessions table
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  status: text('status').default('live'),       // 'live' | 'ended' | 'error'
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  totalMessages: integer('total_messages').default(0),
  totalHighlights: integer('total_highlights').default(0),
  peakIntensity: real('peak_intensity').default(0),
  peakMsgRate: integer('peak_msg_rate').default(0),
  dominantEmotion: text('dominant_emotion'),
  streamTitle: text('stream_title'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_sessions_channel').on(table.channelId, table.startedAt),
]);

// snapshots table
export const snapshots = pgTable('snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  dominant: text('dominant').notNull(),
  hype: real('hype').default(0),
  funny: real('funny').default(0),
  sad: real('sad').default(0),
  angry: real('angry').default(0),
  intensity: real('intensity').default(0),
  msgCount: integer('msg_count').default(0),
}, (table) => [
  index('idx_snapshots_session').on(table.sessionId, table.ts),
]);

// highlights table
export const highlights = pgTable('highlights', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  emotion: text('emotion').notNull(),
  intensity: real('intensity').notNull(),
  durationMs: integer('duration_ms'),
  offsetSec: integer('offset_sec'),
  samples: jsonb('samples'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_highlights_session').on(table.sessionId, table.ts),
]);
