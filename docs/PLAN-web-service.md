# Chat Mood Meter — Web Service 完整開發計畫

> 將 CLI 工具轉型為 Web Service，使用者透過網頁綁定 Twitch / YouTube 帳號，自動分析直播聊天情緒，下載高光時間點檔案。

---

## 目錄

1. [產品概述](#1-產品概述)
2. [系統架構](#2-系統架構)
3. [技術選型](#3-技術選型)
4. [資料庫設計](#4-資料庫設計)
5. [核心模組詳細設計](#5-核心模組詳細設計)
6. [API 設計](#6-api-設計)
7. [前端頁面設計](#7-前端頁面設計)
8. [高光導出格式](#8-高光導出格式)
9. [部署架構](#9-部署架構)
10. [容量評估](#10-容量評估)
11. [開發里程碑](#11-開發里程碑)
12. [風險與對策](#12-風險與對策)

---

## 1. 產品概述

### 使用者流程

```
1. 開啟網站 → 看到 Landing Page（產品介紹）
2. 點擊「Login with Twitch」或「Login with YouTube」
3. OAuth 授權 → 自動綁定帳號
4. 系統偵測到開台 → 自動開始收集聊天 + 情緒分析
5. 直播中 → 使用者可即時查看情緒儀表板
6. 直播結束 → 自動產生場次報告
7. 使用者瀏覽歷史場次 → 查看高光時間點
8. 下載高光檔案 → 匯入剪輯軟體（Premiere / DaVinci / YouTube 描述）
```

### 核心價值

- **零安裝** — 不用裝軟體，瀏覽器直接用
- **自動化** — 開台自動分析，關台自動產生報告
- **多格式導出** — 一鍵匯出到各種剪輯軟體
- **即時可視化** — 直播中就能看到情緒波形

---

## 2. 系統架構

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React SPA)                │
│                                                         │
│  Landing ─→ OAuth Login ─→ Dashboard ─→ Export          │
│                              │                          │
│                        WebSocket (即時)                  │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTPS + WSS
┌─────────────────────────▼───────────────────────────────┐
│                    API Server (Fastify)                  │
│                                                         │
│  Auth ─ Sessions ─ Channels ─ Export ─ WebSocket Hub    │
└───┬─────────────┬──────────────────┬────────────────────┘
    │             │                  │
┌───▼───┐   ┌────▼────┐      ┌──────▼──────┐
│ Redis │   │ Trigger │      │ PostgreSQL  │
│       │   │ Service │      │             │
│ Queue │   │         │      │ users       │
│ PubSub│   │ EventSub│      │ channels    │
│ Cache │   │ Polling │      │ sessions    │
└───┬───┘   └────┬────┘      │ snapshots   │
    │            │           │ highlights  │
┌───▼────────────▼───┐       └─────────────┘
│   Worker Pool      │
│                    │
│  ┌──────┐ ┌──────┐│
│  │ W-1  │ │ W-2  ││  ← 每個 Worker = Collector + Analyzer + Detector
│  │twitch│ │  yt  ││
│  └──────┘ └──────┘│
│  ┌──────┐ ┌──────┐│
│  │ W-3  │ │ ...  ││
│  │twitch│ │      ││
│  └──────┘ └──────┘│
└────────────────────┘
```

### 元件職責

| 元件 | 職責 |
|------|------|
| **API Server** | HTTP API、WebSocket Hub、認證、靜態檔案 |
| **Trigger Service** | 監聽開台/關台事件，派發 worker job |
| **Worker Pool** | 管理多個 channel worker 的生命週期 |
| **Channel Worker** | 單一頻道的聊天收集 + 情緒分析 + 高光偵測 |
| **Redis** | Job queue（BullMQ）、Pub/Sub（即時推送）、快取 |
| **PostgreSQL** | 持久化儲存所有資料 |

---

## 3. 技術選型

| 項目 | 選擇 | 原因 |
|------|------|------|
| 語言 | TypeScript | 前後端統一，複用現有核心 |
| 後端框架 | Fastify | 高效能、原生 TS、Schema 驗證 |
| 前端 | React 19 + Vite | SPA、Chart.js 整合、生態成熟 |
| 資料庫 | PostgreSQL 16 | JSONB、效能、可靠性 |
| ORM | Drizzle ORM | 型別安全、輕量、SQL-like |
| 快取/佇列 | Redis 7 + BullMQ | Worker 排程、Pub/Sub、session 快取 |
| 認證 | 自建 OAuth 2.0 client | Twitch/YouTube 各自的 OAuth flow |
| Token | JWT（access）+ DB（refresh） | 無狀態 API + 安全刷新 |
| Monorepo | Turborepo | 共享核心模組、統一 build |
| 部署 | Docker Compose | 一鍵啟動所有服務 |
| 反向代理 | Caddy | 自動 HTTPS、WebSocket proxy |

---

## 4. 資料庫設計

### ER 圖

```
users ──< channels ──< sessions ──< snapshots
                            │
                            └──< highlights
```

### Schema

```sql
-- ═══════════════════════════════════════
-- 使用者
-- ═══════════════════════════════════════
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,              -- 'twitch' | 'youtube'
  provider_id     TEXT NOT NULL,              -- 平台 user ID
  username        TEXT NOT NULL,
  display_name    TEXT,
  email           TEXT,
  avatar_url      TEXT,
  access_token    TEXT NOT NULL,              -- 加密儲存（AES-256-GCM）
  refresh_token   TEXT,
  token_expires   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider, provider_id)
);

-- ═══════════════════════════════════════
-- 綁定的頻道
-- ═══════════════════════════════════════
CREATE TABLE channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,              -- 'twitch' | 'youtube'
  channel_id      TEXT NOT NULL,              -- 平台 channel/room ID
  channel_name    TEXT NOT NULL,
  enabled         BOOLEAN DEFAULT true,
  auto_start      BOOLEAN DEFAULT true,       -- 開台自動分析
  analyzer_mode   TEXT DEFAULT 'rules',       -- 'rules' | 'llm'
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, platform, channel_id)
);

-- ═══════════════════════════════════════
-- 直播場次
-- ═══════════════════════════════════════
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status          TEXT DEFAULT 'live',        -- 'live' | 'ended' | 'error'
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  total_messages  INTEGER DEFAULT 0,
  total_highlights INTEGER DEFAULT 0,
  peak_intensity  REAL DEFAULT 0,
  peak_msg_rate   INTEGER DEFAULT 0,
  dominant_emotion TEXT,
  stream_title    TEXT,                       -- 從平台 API 取得
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════
-- 情緒快照（每秒一筆，量最大）
-- ═══════════════════════════════════════
CREATE TABLE snapshots (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts              TIMESTAMPTZ NOT NULL,
  dominant        TEXT NOT NULL,
  hype            REAL DEFAULT 0,
  funny           REAL DEFAULT 0,
  sad             REAL DEFAULT 0,
  angry           REAL DEFAULT 0,
  intensity       REAL DEFAULT 0,
  msg_count       INTEGER DEFAULT 0
);

-- ═══════════════════════════════════════
-- 高光標記
-- ═══════════════════════════════════════
CREATE TABLE highlights (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts              TIMESTAMPTZ NOT NULL,
  emotion         TEXT NOT NULL,
  intensity       REAL NOT NULL,
  duration_ms     INTEGER,
  offset_sec      INTEGER,                    -- 從直播開始的秒數（方便導出）
  samples         JSONB,                      -- 代表性訊息
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════
-- 索引
-- ═══════════════════════════════════════
CREATE INDEX idx_channels_user ON channels(user_id);
CREATE INDEX idx_sessions_channel ON sessions(channel_id, started_at DESC);
CREATE INDEX idx_snapshots_session ON snapshots(session_id, ts);
CREATE INDEX idx_highlights_session ON highlights(session_id, ts);
CREATE INDEX idx_users_provider ON users(provider, provider_id);
```

### 資料量估算

```
每場直播（3 小時）：
  snapshots: 3 × 3600 = 10,800 筆
  highlights: ~10-30 筆

100 位活躍使用者 × 每週 3 場：
  snapshots: 100 × 3 × 10,800 = 3.24M 筆/週 ≈ 14M 筆/月
  highlights: 100 × 3 × 20 = 6,000 筆/週

每筆 snapshot ~100 bytes → 14M × 100B ≈ 1.4GB/月
每筆 highlight ~500 bytes → 6K × 500B ≈ 3MB/月

→ 需要定期清理舊資料（保留 90 天）或分區
```

---

## 5. 核心模組詳細設計

### 5.1 Auth 模組

```
POST /auth/twitch          → 重定向到 Twitch OAuth
GET  /auth/twitch/callback → 處理 callback、建立/更新 user、發 JWT
POST /auth/youtube         → 重定向到 YouTube OAuth
GET  /auth/youtube/callback→ 同上
POST /auth/refresh         → 用 refresh token 換新 access token
POST /auth/logout          → 清除 session
```

**Twitch OAuth Flow：**
```
1. 前端 → /auth/twitch
2. Server 重定向 → https://id.twitch.tv/oauth2/authorize?
     client_id=...&redirect_uri=.../callback&scope=user:read:email+chat:read
3. 使用者授權
4. Twitch 重定向 → /auth/twitch/callback?code=...
5. Server 用 code 換 access_token + refresh_token
6. 取 user profile（GET https://api.twitch.tv/helix/users）
7. Upsert users table
8. 自動建立 channel（用使用者自己的頻道）
9. 發 JWT → 回前端
```

**YouTube OAuth Flow：**
```
1. 前端 → /auth/youtube
2. Server 重定向 → https://accounts.google.com/o/oauth2/v2/auth?
     scope=https://www.googleapis.com/auth/youtube.readonly
3. 使用者授權
4. Google 重定向 → /auth/youtube/callback?code=...
5. Server 用 code 換 token
6. 取 channel info（GET youtube/v3/channels?mine=true）
7. Upsert users + channels
8. 發 JWT
```

### 5.2 Trigger Service

負責偵測使用者的直播狀態，在開台/關台時通知 Worker Pool。

**Twitch — EventSub（Webhook 模式）：**
```
使用者綁定帳號時：
  → 呼叫 Twitch API 建立 EventSub subscription
  → 訂閱事件：stream.online / stream.offline
  → Webhook URL: https://api.example.com/webhooks/twitch

Twitch 會主動 POST 到我們的 webhook：
  stream.online  → enqueue start-worker job
  stream.offline → enqueue stop-worker job
```

**YouTube — Polling 模式：**
```
背景 cron job（每 60 秒）：
  → 查詢所有 enabled 的 YouTube channels
  → GET youtube/v3/liveBroadcasts?broadcastStatus=active&mine=true
  → 有新直播 → enqueue start-worker job
  → 直播消失 → enqueue stop-worker job

Quota 管理：
  liveBroadcasts.list = 100 units/call
  每 60 秒 poll N 個使用者（batch query）
  100 users × 1 call/min × 100 units = 10,000 units/100 min
  → 一天 144,000 units，超出 10,000/day 免費額度
  → 解法：batch query（一次 API call 查多人）+ 動態頻率
  → 或用 YouTube Pub/Sub Hubbub（免費推送）
```

### 5.3 Worker Pool

```typescript
// ── Worker Pool 主程式 ─────────────────────────

import { Worker as BullWorker, Queue } from 'bullmq';

const channelQueue = new Queue('channel-workers', { connection: redis });

// BullMQ Worker：從 queue 認領 job 並執行
const bullWorker = new BullWorker('channel-workers', async (job) => {
  const { action, channelId, platform, channelName, userId } = job.data;

  if (action === 'start') {
    await workerPool.spawn({
      jobId: job.id,
      channelId,
      platform,
      channelName,
      userId,
    });

    // 這個 job 會一直「運行」到頻道關台
    // 用 BullMQ 的 long-running job 模式
    return new Promise((resolve) => {
      workerPool.onWorkerDone(job.id, resolve);
    });

  } else if (action === 'stop') {
    await workerPool.kill(channelId, 'stream offline');
  }
}, { connection: redis, concurrency: 150 });
```

### 5.4 Channel Worker（單一頻道）

```typescript
class ChannelWorker {
  private collector: TwitchCollector | YouTubeCollector;
  private analyzer: RulesAnalyzer;
  private detector: HighlightDetector;
  private batchWriter: BatchWriter;
  private sessionId: string;
  private streamStartedAt: Date;

  constructor(private config: WorkerConfig) {}

  async start(): Promise<void> {
    // 1. 建立 DB session
    this.sessionId = await db.createSession(this.config.channelId);
    this.streamStartedAt = new Date();

    // 2. 初始化核心元件（複用現有模組）
    this.collector = this.config.platform === 'twitch'
      ? new TwitchCollector({ channel: this.config.channelName })
      : new YouTubeCollector({ liveChatId: this.config.liveChatId });

    this.analyzer = new RulesAnalyzer({ snapshotIntervalMs: 1000 });
    this.detector = new HighlightDetector(defaultHighlightConfig);
    this.batchWriter = new BatchWriter(this.sessionId);

    // 3. 接線
    this.collector.on('message', (msg) => this.analyzer.feed(msg));

    this.analyzer.on('snapshot', (snap) => {
      this.batchWriter.addSnapshot(snap);
      // Pub/Sub 推送給訂閱的前端
      redis.publish(`live:${this.config.channelId}`, JSON.stringify({
        type: 'snapshot', data: snap
      }));
    });

    this.detector.on('highlight', (marker) => {
      // 計算 offset（從直播開始的秒數）
      marker.offsetSec = Math.floor((marker.timestamp - this.streamStartedAt.getTime()) / 1000);
      this.batchWriter.addHighlight(marker);
      redis.publish(`live:${this.config.channelId}`, JSON.stringify({
        type: 'highlight', data: marker
      }));
    });

    this.analyzer.on('snapshot', (snap) => this.detector.feed(snap));

    // 4. 啟動
    this.analyzer.start();
    await this.collector.start();
  }

  async stop(reason: string): Promise<void> {
    this.analyzer.stop();
    await this.collector.stop();
    await this.batchWriter.flush();
    await db.endSession(this.sessionId);
    console.log(`[Worker] ${this.config.channelName} stopped: ${reason}`);
  }
}
```

### 5.5 BatchWriter（批次寫入）

```typescript
class BatchWriter {
  private snapshotBuffer: Snapshot[] = [];
  private highlightBuffer: Highlight[] = [];
  private timer: NodeJS.Timeout;

  constructor(private sessionId: string) {
    // 每 5 秒自動 flush
    this.timer = setInterval(() => this.flush(), 5000);
  }

  addSnapshot(snap: Snapshot): void {
    this.snapshotBuffer.push(snap);
  }

  addHighlight(h: Highlight): void {
    this.highlightBuffer.push(h);
  }

  async flush(): Promise<void> {
    // 原子取走 buffer
    const snaps = this.snapshotBuffer.splice(0);
    const highlights = this.highlightBuffer.splice(0);

    if (snaps.length > 0) {
      // Multi-row INSERT（一次寫 5 筆比 5 次寫 1 筆快很多）
      await db.batchInsertSnapshots(this.sessionId, snaps);
    }

    if (highlights.length > 0) {
      await db.batchInsertHighlights(this.sessionId, highlights);
    }
  }

  async destroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
```

### 5.6 WebSocket Hub（即時推送）

```typescript
// API Server 端

import { Redis } from 'ioredis';

const sub = new Redis();  // 訂閱用
const wsClients = new Map<string, Set<WebSocket>>();  // channelId → WS clients

// 使用者連線時
fastify.get('/ws/live/:channelId', { websocket: true }, (ws, req) => {
  const { channelId } = req.params;

  if (!wsClients.has(channelId)) {
    wsClients.set(channelId, new Set());
    sub.subscribe(`live:${channelId}`);  // 首位訂閱者才訂閱 Redis
  }
  wsClients.get(channelId).add(ws);

  ws.on('close', () => {
    wsClients.get(channelId)?.delete(ws);
    if (wsClients.get(channelId)?.size === 0) {
      wsClients.delete(channelId);
      sub.unsubscribe(`live:${channelId}`);
    }
  });
});

// Redis 收到推送 → 轉發給所有 WS client
sub.on('message', (channel, message) => {
  const channelId = channel.replace('live:', '');
  const clients = wsClients.get(channelId);
  if (!clients) return;
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(message);
  }
});
```

---

## 6. API 設計

### Auth

| Method | Path | 說明 |
|--------|------|------|
| GET | `/auth/twitch` | 開始 Twitch OAuth |
| GET | `/auth/twitch/callback` | Twitch OAuth callback |
| GET | `/auth/youtube` | 開始 YouTube OAuth |
| GET | `/auth/youtube/callback` | YouTube OAuth callback |
| POST | `/auth/refresh` | 刷新 JWT |
| POST | `/auth/logout` | 登出 |

### User

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/me` | 取得當前使用者資訊 |
| DELETE | `/api/me` | 刪除帳號 + 所有資料 |

### Channels

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/channels` | 列出綁定的頻道 |
| POST | `/api/channels` | 新增頻道 |
| PATCH | `/api/channels/:id` | 更新頻道設定 |
| DELETE | `/api/channels/:id` | 移除頻道 |

### Sessions

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/sessions` | 列出場次（分頁、篩選） |
| GET | `/api/sessions/:id` | 場次詳情 |
| GET | `/api/sessions/:id/snapshots` | 快照資料（支援 ?from=&to=） |
| GET | `/api/sessions/:id/highlights` | 高光列表 |
| DELETE | `/api/sessions/:id` | 刪除場次 |

### Export

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/sessions/:id/export/json` | JSON 完整資料 |
| GET | `/api/sessions/:id/export/csv` | CSV 快照 |
| GET | `/api/sessions/:id/export/edl` | EDL 剪輯標記 |
| GET | `/api/sessions/:id/export/chapters` | YouTube 章節 |
| GET | `/api/sessions/:id/export/srt` | SRT 字幕 |
| GET | `/api/sessions/:id/export/html` | HTML 獨立報告 |

### Webhooks

| Method | Path | 說明 |
|--------|------|------|
| POST | `/webhooks/twitch` | Twitch EventSub 回呼 |

### WebSocket

| Path | 說明 |
|------|------|
| `WSS /ws/live/:channelId` | 即時 snapshot + highlight 推送 |

---

## 7. 前端頁面設計

### 路由結構

```
/                       Landing Page
/login                  OAuth 登入選擇
/auth/callback          OAuth callback 中繼頁
/dashboard              主控台首頁（場次列表 + 統計）
/dashboard/live         即時監控（直播中）
/dashboard/sessions/:id 場次詳情 + 時間軸 + 高光
/dashboard/export/:id   導出頁面（選格式 + 預覽 + 下載）
/settings               帳號設定 + 頻道管理
```

### Landing Page（/）

```
┌─────────────────────────────────────────┐
│  🎭 Chat Mood Meter                    │
│                                         │
│  See your chat's emotions in real-time  │
│  Auto-detect highlights for editing     │
│                                         │
│  [Login with Twitch] [Login with YouTube]│
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ 即時分析 │ │ 自動高光 │ │ 一鍵導出 │  │
│  │ 情緒波形 │ │ 時間標記 │ │ 剪輯標記 │  │
│  └─────────┘ └─────────┘ └─────────┘  │
│                                         │
│  [Demo Animation — overlay preview]     │
└─────────────────────────────────────────┘
```

### Dashboard 首頁（/dashboard）

```
┌─────────────────────────────────────────┐
│  Stats Banner                           │
│  [Total Sessions] [Highlights] [Hours]  │
├─────────────────┬───────────────────────┤
│  Recent Sessions│  Emotion Trends       │
│  ┌────────────┐ │  ┌─────────────────┐  │
│  │ Mar 13     │ │  │ Stacked Bar     │  │
│  │ 🔥 3h 2m  │ │  │ Chart           │  │
│  │ 12 highlights│ │                   │  │
│  └────────────┘ │  └─────────────────┘  │
│  ┌────────────┐ │                       │
│  │ Mar 12     │ │  Radar Chart          │
│  │ 😂 1h 45m │ │  ┌─────────────────┐  │
│  └────────────┘ │  │                 │  │
│                 │  └─────────────────┘  │
└─────────────────┴───────────────────────┘
```

### 即時監控（/dashboard/live）

```
┌─────────────────────────────────────────┐
│  🔴 LIVE — channelName                  │
├────────────────────────┬────────────────┤
│                        │  Current Mood  │
│  ┌──────────────────┐  │  🔥 HYPE 85%  │
│  │  Emotion Waveform │  │               │
│  │  (Canvas 波形圖)  │  │  23 msg/s     │
│  │  — 複用 overlay — │  │               │
│  └──────────────────┘  │  Highlights: 5 │
│                        │               │
│  ┌──────────────────┐  │  Chat Feed    │
│  │ Highlight Feed   │  │  user1: poggg │
│  │ #1 🔥 00:05:23   │  │  user2: LUL   │
│  │ #2 😂 00:12:47   │  │  user3: 笑死  │
│  └──────────────────┘  │               │
└────────────────────────┴────────────────┘
```

### 導出頁面（/dashboard/export/:id）

```
┌─────────────────────────────────────────┐
│  Export Highlights — Mar 13 Session     │
├─────────────────────────────────────────┤
│                                         │
│  Format:                                │
│  (●) YouTube Chapters                   │
│  ( ) EDL (Premiere / DaVinci)           │
│  ( ) CSV                                │
│  ( ) SRT Subtitles                      │
│  ( ) JSON                               │
│  ( ) HTML Report                        │
│                                         │
│  Select Highlights:                     │
│  [✓] #1 🔥 00:05:23 HYPE 92%          │
│  [✓] #2 😂 00:12:47 FUNNY 85%         │
│  [ ] #3 😢 00:31:02 SAD 45%           │
│  [✓] #4 🔥 01:05:11 HYPE 88%          │
│                                         │
│  Preview:                               │
│  ┌───────────────────────────────────┐  │
│  │ 00:00:00 Stream Start             │  │
│  │ 00:05:23 🔥 HYPE — chat exploded!│  │
│  │ 00:12:47 😂 FUNNY — dying laughing│  │
│  │ 01:05:11 🔥 HYPE — massive play  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [📋 Copy to Clipboard]  [⬇ Download]  │
└─────────────────────────────────────────┘
```

---

## 8. 高光導出格式

### YouTube Chapters（最常用）
```
00:00:00 Stream Start
00:05:23 🔥 HYPE moment — chat exploded!
00:12:47 😂 FUNNY — viewers dying of laughter
00:31:02 😢 SAD — emotional scene
01:05:11 🔥 HYPE — massive play!
```
直接貼到 YouTube 影片描述即可自動產生章節。

### EDL（CMX3600 — Premiere / DaVinci Resolve）
```
TITLE: Chat Mood Meter Highlights — 2026-03-13
FCM: NON-DROP FRAME

001  AX       V     C        00:05:23:00 00:05:53:00 00:05:23:00 00:05:53:00
* HIGHLIGHT: HYPE 92% — chat exploded

002  AX       V     C        00:12:47:00 00:13:17:00 00:12:47:00 00:13:17:00
* HIGHLIGHT: FUNNY 85% — dying of laughter
```

### CSV
```csv
#,Timestamp,Offset,Emotion,Intensity,Duration,Summary
1,2026-03-13T17:05:23Z,00:05:23,hype,0.92,30s,chat exploded
2,2026-03-13T17:12:47Z,00:12:47,funny,0.85,30s,dying of laughter
```

### SRT（字幕格式）
```
1
00:05:23,000 --> 00:05:53,000
🔥 HYPE — 92% intensity
Chat exploded!

2
00:12:47,000 --> 00:13:17,000
😂 FUNNY — 85% intensity
Dying of laughter
```

### JSON
```json
{
  "session": {
    "id": "...",
    "channel": "xqc",
    "started": "2026-03-13T17:00:00Z",
    "duration": "3h 15m"
  },
  "highlights": [
    {
      "offset": "00:05:23",
      "offsetSec": 323,
      "emotion": "hype",
      "intensity": 0.92,
      "duration": 30,
      "summary": "chat exploded",
      "samples": ["PogChamp", "LETS GOO", "好耶好耶"]
    }
  ]
}
```

### HTML Report
獨立的深色主題 HTML 報告（複用現有 ExportManager），含 Chart.js 折線圖 + 高光列表。

---

## 9. 部署架構

### Docker Compose

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://cmm:password@postgres:5432/chatmoodmeter
      - REDIS_URL=redis://redis:6379
      - TWITCH_CLIENT_ID=...
      - TWITCH_CLIENT_SECRET=...
      - YOUTUBE_CLIENT_ID=...
      - YOUTUBE_CLIENT_SECRET=...
      - JWT_SECRET=...
      - ENCRYPTION_KEY=...        # Token 加密用
    depends_on:
      - postgres
      - redis

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - DATABASE_URL=postgresql://cmm:password@postgres:5432/chatmoodmeter
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./packages/db/migrations:/docker-entrypoint-initdb.d
    environment:
      - POSTGRES_DB=chatmoodmeter
      - POSTGRES_USER=cmm
      - POSTGRES_PASSWORD=password

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddydata:/data

volumes:
  pgdata:
  redisdata:
  caddydata:
```

### Caddyfile
```
chatmoodmeter.com {
  # API + WebSocket
  handle /api/* {
    reverse_proxy api:3000
  }
  handle /ws/* {
    reverse_proxy api:3000
  }
  handle /auth/* {
    reverse_proxy api:3000
  }
  handle /webhooks/* {
    reverse_proxy api:3000
  }
  # Frontend SPA
  handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
  }
}
```

---

## 10. 容量評估

### 硬體需求（2 vCPU / 4GB RAM）

| 元件 | RAM | CPU |
|------|-----|-----|
| OS + 系統 | 400MB | — |
| API Server | 80MB | 0.1 core |
| Worker Pool 主程序 | 60MB | 0.05 core |
| PostgreSQL | 200MB | 0.2 core |
| Redis | 50MB | 0.05 core |
| Caddy | 20MB | 0.02 core |
| **系統小計** | **810MB** | **0.42 core** |
| **可用給 Workers** | **3.2GB** | **1.58 core** |

### 同時 Worker 數

| 頻道規模 | RAM/Worker | 同時數 |
|----------|-----------|--------|
| 小台 (<1k 觀眾) | ~20MB | ~150 |
| 中台 (1k-10k) | ~30MB | ~100 |
| 大台 (>10k) | ~60MB | ~50 |
| 混合 | ~30MB | ~100 |

### 使用者承載量

```
假設：
- 同時在線率 12%（100 人裡 12 人同時在直播）
- 混合頻道規模

100 workers ÷ 12% = ~800 位註冊使用者

保守估計：500-800 人
```

### DB 容量（每月）

| 項目 | 量 | 大小 |
|------|-----|------|
| snapshots | ~14M 筆 | ~1.4GB |
| highlights | ~6K 筆 | ~3MB |
| 其他 | — | ~100MB |
| **月增** | — | **~1.5GB** |

90 天保留 → 最大 ~5GB，PostgreSQL 輕鬆處理。

---

## 11. 開發里程碑

### M1 — Monorepo 重構（1 session）
- 建立 Turborepo 結構
- 現有核心程式碼抽進 `packages/core/`
- Collector 抽進 `packages/collector/`
- 確保現有 168 個 unit tests 全部通過

### M2 — 資料庫 + ORM（1 session）
- PostgreSQL schema + migrations
- Drizzle ORM setup
- DB 存取層（Repository pattern）
- BatchWriter 實作
- 資料遷移工具（SQLite → PostgreSQL）

### M3 — Auth 系統（1 session）
- Twitch OAuth 2.0 complete flow
- YouTube OAuth 2.0 complete flow
- JWT 發行 + 驗證 middleware
- Token 加密儲存
- 帳號 CRUD

### M4 — Worker Pool + Trigger（1 session）
- BullMQ job queue setup
- WorkerPool class
- ChannelWorker class（複用核心模組）
- Trigger Service（Twitch EventSub + YouTube polling）
- 健康檢查 + 自動重啟

### M5 — API Server（1 session）
- Fastify setup + 路由
- 所有 REST endpoints
- WebSocket Hub（Redis Pub/Sub fanout）
- Request validation（Zod schema）
- Rate limiting

### M6 — 高光導出（1 session）
- 6 種格式：JSON / CSV / EDL / YouTube Chapters / SRT / HTML
- 導出 API
- 選擇性導出（勾選特定高光）
- offset_sec 計算（相對直播開始時間）

### M7 — Frontend SPA（2 sessions）
- React + Vite + React Router
- Landing Page
- OAuth 登入流程
- Dashboard 首頁（場次列表 + 統計圖表）
- 即時監控頁面（WebSocket + Canvas 波形）
- 場次詳情（時間軸 + 高光列表）
- 導出頁面（格式選擇 + 預覽 + 下載/複製）
- Settings（帳號 + 頻道管理）

### M8 — Docker 化 + 部署（1 session）
- Dockerfile.api + Dockerfile.worker
- docker-compose.yml
- Caddyfile（HTTPS + 反向代理）
- 環境變數管理
- 健康檢查端點
- 部署腳本

### M9 — 通知 + 打磨（1 session）
- Discord Webhook 通知（高光觸發 / 直播結束報告）
- Email 通知（可選）
- 錯誤監控（Sentry）
- 效能優化（DB 查詢、快取）
- 文件（API docs、README）

**總計：10 sessions**

---

## 12. 風險與對策

| 風險 | 影響 | 對策 |
|------|------|------|
| **YouTube API Quota** | 每天 10,000 units 不夠 | 用 Pub/Sub Hubbub 推送 + 動態 polling 頻率 |
| **Twitch IRC 規模** | 大台 >50k 觀眾訊息爆量 | Worker 內部抽樣（保留 emote 密集的訊息） |
| **DB 寫入瓶頸** | 高峰期 100+ writes/sec | BatchWriter 批次寫入 + 連線池 |
| **OAuth Token 過期** | 連線中斷 | 背景 cron 定期刷新，提前 10 分鐘刷 |
| **Worker 記憶體洩漏** | 長時間運行 OOM | Worker 超過 8 小時自動重啟 |
| **EventSub 丟失** | 漏掉開台事件 | 每 5 分鐘 fallback polling Twitch streams API |
| **使用者刪帳號** | GDPR 合規 | CASCADE DELETE + 立即清除 token |
| **DDoS / 濫用** | 服務不可用 | Rate limiting + Cloudflare + 帳號綁定才能用 |

---

## 專案結構

```
chat-mood-meter/
├── apps/
│   ├── web/                      # React SPA
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── Landing.tsx
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── LiveMonitor.tsx
│   │   │   │   ├── SessionDetail.tsx
│   │   │   │   ├── Export.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── api/                      # Fastify API Server
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── channels.ts
│   │   │   │   ├── export.ts
│   │   │   │   └── webhooks.ts
│   │   │   ├── services/
│   │   │   │   ├── trigger.ts
│   │   │   │   └── ws-hub.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   └── rate-limit.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── worker/                   # Worker Pool
│       ├── src/
│       │   ├── pool.ts
│       │   ├── channel-worker.ts
│       │   ├── batch-writer.ts
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   ├── core/                     # 共用核心（現有模組）
│   │   ├── analyzer/
│   │   ├── highlight/
│   │   └── types.ts
│   │
│   ├── collector/                # 收集器
│   │   ├── twitch.ts
│   │   └── youtube.ts
│   │
│   ├── db/                       # Drizzle schema + migrations
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── repository.ts
│   │
│   └── export/                   # 導出格式
│       ├── json.ts
│       ├── csv.ts
│       ├── edl.ts
│       ├── chapters.ts
│       ├── srt.ts
│       └── html.ts
│
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.worker
├── Caddyfile
├── turbo.json
└── package.json
```

---

_Made with 🍂 by aki-terminal-leaf_
