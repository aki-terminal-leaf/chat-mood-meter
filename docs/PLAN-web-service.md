# Web Service 版本計畫

> 目標：讓使用者不需要在本機跑程式，直接透過網頁綁定 Twitch / YouTube 帳號，自動分析聊天情緒，並下載高光時間點檔案。

## 使用者故事

1. 使用者開啟網站，用 Twitch 或 YouTube 帳號登入
2. 系統自動偵測該帳號正在直播 → 開始收集聊天訊息 + 情緒分析
3. 直播中：使用者可即時查看情緒儀表板
4. 直播結束：使用者可瀏覽歷史場次、查看高光時間點
5. 使用者下載高光檔案（JSON / CSV / EDL / 章節標記），匯入剪輯軟體

## 架構

```
┌─────────────────────────────────────────────────┐
│                   Frontend (SPA)                │
│  Landing → OAuth Login → Dashboard → Export     │
└──────────────────────┬──────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────┐
│                  API Server                      │
│  Auth · Session Manager · Export API             │
└──┬───────────────┬───────────────┬──────────────┘
   │               │               │
┌──▼──┐     ┌──────▼──────┐   ┌───▼────┐
│Queue│     │  Workers     │   │  DB    │
│Redis│     │  per-channel │   │Postgres│
└──┬──┘     │  collector   │   └────────┘
   │        │  + analyzer  │
   │        └──────────────┘
   │
┌──▼──────────────────────┐
│  Twitch IRC / EventSub  │
│  YouTube Live Chat API  │
└─────────────────────────┘
```

## Phase 1：核心 Web Service

### P1-1 — Auth 系統
- **Twitch OAuth 2.0**
  - Scope: `user:read:email`, `chat:read`
  - 取得 user profile + access token
  - EventSub 訂閱 stream.online / stream.offline
- **YouTube OAuth 2.0**
  - Scope: `youtube.readonly`
  - 取得 channel info + live chat ID
  - Polling liveBroadcasts API 偵測開台
- **Session 管理**
  - JWT access token（15min）+ refresh token（7d）
  - Cookie httpOnly + secure

### P1-2 — 多租戶 Worker 架構
- 每個活躍頻道一個 worker process / thread
- Worker 生命週期：
  ```
  stream.online → spawn worker → collect + analyze → stream.offline → 產生報告 → shutdown
  ```
- Worker 內容 = 現有 Collector + Analyzer + HighlightDetector（複用）
- Worker 管理：
  - Bull/BullMQ job queue（Redis）
  - 自動 scale：偵測到開台 → 排 job → worker pool 認領
  - 限制：免費用戶最多 1 個頻道同時分析

### P1-3 — 資料庫（PostgreSQL）
```sql
-- 使用者
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,        -- 'twitch' | 'youtube'
  provider_id TEXT NOT NULL,        -- 平台 user ID
  username    TEXT,
  email       TEXT,
  avatar_url  TEXT,
  access_token TEXT,                -- 加密儲存
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  plan        TEXT DEFAULT 'free',  -- 'free' | 'pro'
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider, provider_id)
);

-- 連結的頻道
CREATE TABLE channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  platform    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  channel_name TEXT,
  enabled     BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 直播場次
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID REFERENCES channels(id),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  total_messages INTEGER DEFAULT 0,
  total_highlights INTEGER DEFAULT 0,
  metadata    JSONB DEFAULT '{}'
);

-- 情緒快照（逐秒，大量資料）
CREATE TABLE snapshots (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID REFERENCES sessions(id),
  timestamp   TIMESTAMPTZ NOT NULL,
  dominant    TEXT NOT NULL,
  scores      JSONB NOT NULL,       -- {hype, funny, sad, angry}
  intensity   REAL,
  msg_count   INTEGER
);

-- 高光標記
CREATE TABLE highlights (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID REFERENCES sessions(id),
  timestamp   TIMESTAMPTZ NOT NULL,
  emotion     TEXT NOT NULL,
  intensity   REAL,
  duration_ms INTEGER,
  samples     JSONB                 -- 代表性訊息
);

-- 索引
CREATE INDEX idx_snapshots_session ON snapshots(session_id, timestamp);
CREATE INDEX idx_highlights_session ON highlights(session_id, timestamp);
```

### P1-4 — 高光導出格式

| 格式 | 用途 | 說明 |
|------|------|------|
| **JSON** | 通用 | 完整結構化資料 |
| **CSV** | Excel / Google Sheets | 時間戳 + 情緒 + 強度 |
| **EDL** (Edit Decision List) | Premiere / DaVinci | 業界標準剪輯標記 |
| **Chapter Markers** | YouTube | `00:05:23 🔥 HYPE 92%` 格式，直接貼影片描述 |
| **SRT** | 字幕軟體 | 高光時段以字幕形式顯示 |
| **Markers.xml** | OBS | OBS 章節標記匯入 |

```
// YouTube 章節格式範例
00:00:00 Stream Start
00:05:23 🔥 HYPE moment — chat exploded!
00:12:47 😂 FUNNY — viewers dying of laughter
00:31:02 😢 SAD — emotional scene
```

```
// EDL 範例（CMX3600）
TITLE: Stream Highlights 2026-03-13
001  001      V     C        00:05:23:00 00:05:53:00 00:05:23:00 00:05:53:00
* HIGHLIGHT: 🔥 HYPE 92%
002  001      V     C        00:12:47:00 00:13:17:00 00:12:47:00 00:13:17:00
* HIGHLIGHT: 😂 FUNNY 85%
```

## Phase 2：Frontend SPA

### 頁面結構

```
/                   → Landing page（產品介紹 + CTA）
/login              → OAuth 選擇（Twitch / YouTube）
/callback/twitch    → OAuth callback
/callback/youtube   → OAuth callback
/dashboard          → 主控台（需登入）
/dashboard/live     → 即時監控（直播中）
/dashboard/history  → 歷史場次列表
/dashboard/:id      → 場次詳情 + 導出
/settings           → 帳號設定 + 頻道管理
```

### 即時監控頁面（/dashboard/live）
- 複用現有 overlay 的 Canvas 波形圖
- 加上：即時聊天流（側欄）、高光計數器、當前觀眾數
- WebSocket 連線到後端取得即時 snapshot

### 歷史場次（/dashboard/history）
- 複用現有 Dashboard 的設計
- 加上：搜尋 / 篩選、日期範圍、情緒類型

### 導出頁面
- 勾選要導出的高光（或全選）
- 選擇格式（JSON / CSV / EDL / YouTube Chapter / SRT）
- 預覽 → 下載
- 「複製到剪貼簿」按鈕（YouTube 章節格式）

## Phase 3：進階功能

### P3-1 — Twitch EventSub（Webhook）
- 取代 polling，即時接收開台/關台事件
- Webhook endpoint: `POST /api/webhooks/twitch`
- 自動驗證 Twitch 簽名

### P3-2 — YouTube Data API 整合
- liveBroadcasts.list 偵測直播狀態
- liveChatMessages.list 收集聊天（需 quota 管理）
- YouTube quota: 10,000 units/day，liveChatMessages.list = 5 units
  - 每 5 秒 poll = 720 次/小時 = 3,600 units/hr
  - 一場 3 小時直播 ≈ 10,800 units → 超出免費額度
  - 解法：動態調整 poll 間隔（低聊天量時放慢）

### P3-3 — 付費方案
| 功能 | Free | Pro ($5/mo) |
|------|------|-------------|
| 同時分析頻道 | 1 | 5 |
| 歷史保留 | 7 天 | 90 天 |
| 導出格式 | JSON / CSV | 全部（含 EDL / SRT） |
| LLM 分析 | ✗ | ✓ |
| API 存取 | ✗ | ✓ |
| 即時通知 | ✗ | Webhook / Discord |

### P3-4 — 通知系統
- 高光觸發時推送通知（Discord Webhook / Email）
- 直播結束時自動寄送報告
- 可設定情緒閾值和通知頻率

## 技術選型

| 項目 | 選擇 | 原因 |
|------|------|------|
| 後端框架 | Fastify | 效能好、TypeScript 原生支援、插件生態 |
| 前端 | React + Vite | SPA、Chart.js 整合方便 |
| 資料庫 | PostgreSQL | JSONB 支援、效能、擴展性 |
| 快取/佇列 | Redis + BullMQ | Worker 排程、session 快取 |
| 認證 | Passport.js | Twitch/YouTube OAuth 策略成熟 |
| ORM | Drizzle | 型別安全、輕量 |
| 部署 | Docker Compose | 一鍵部署（API + Worker + Redis + PG） |
| 未來 | Kubernetes | 自動擴展 worker pod |

## 檔案結構（預計）

```
chat-mood-meter/
├── apps/
│   ├── web/                  # React SPA
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   └── vite.config.ts
│   │
│   └── api/                  # Fastify API server
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── workers/
│       │   ├── auth/
│       │   └── export/
│       └── package.json
│
├── packages/
│   ├── core/                 # 共用核心（現有 analyzer, highlight, types）
│   ├── collector/            # 收集器（現有 + YouTube 增強）
│   └── db/                   # Drizzle schema + migrations
│
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.worker
└── turbo.json                # Turborepo monorepo 管理
```

## 開發里程碑

| 里程碑 | 內容 | 預估 |
|--------|------|------|
| M1 | Monorepo 重構 + 核心抽離 | 1 session |
| M2 | Auth 系統（Twitch + YouTube OAuth） | 1 session |
| M3 | Worker 架構 + 多租戶 | 1 session |
| M4 | PostgreSQL 遷移 + API 端點 | 1 session |
| M5 | Frontend SPA（Landing + Dashboard） | 2 sessions |
| M6 | 高光導出（6 種格式） | 1 session |
| M7 | 即時監控 WebSocket | 1 session |
| M8 | Docker 化 + 部署 | 1 session |
| M9 | 付費方案 + Stripe | 1 session |

## 風險與注意事項

1. **YouTube API Quota** — 免費額度有限，需要智慧 polling 策略
2. **Twitch IRC 規模** — 大型頻道（>50k 觀眾）訊息量極大，worker 需要能處理
3. **資料量** — 逐秒快照每場 3,600 筆，100 位用戶 × 30 場/月 = 10.8M 筆/月 → 需要分區或定期清理
4. **GDPR** — 儲存使用者資料需要隱私政策和刪除機制
5. **OAuth Token 刷新** — 需要背景 job 定期刷新 token，避免斷線
6. **成本** — PostgreSQL + Redis + Worker 至少需要一台 VPS（$20/mo 起）

---

_Made with 🍂 by aki-terminal-leaf_
