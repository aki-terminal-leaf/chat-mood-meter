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

#### 核心問題

一台 server 要同時幫 N 個使用者分析 N 個不同的直播頻道。每個頻道都需要：
- 一條持續的 IRC / Chat 連線（收訊息）
- 一個 Analyzer 實例（算情緒）
- 一個 HighlightDetector 實例（抓高光）
- 定期寫 DB

這些都是有狀態的長時間運作，不適合用 stateless HTTP request 處理。

#### 架構：Worker Pool + Job Queue

```
                    ┌─────────────┐
                    │  Trigger    │  ← Twitch EventSub / YouTube polling / 手動
                    │  Service    │
                    └──────┬──────┘
                           │ enqueue job
                    ┌──────▼──────┐
                    │   Redis     │  ← BullMQ job queue
                    │   Queue     │
                    └──────┬──────┘
                           │ dequeue
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐  ┌───▼─────┐  ┌───▼─────┐
         │Worker 1 │  │Worker 2 │  │Worker 3 │  ← Worker Pool（可水平擴展）
         │ch: xqc  │  │ch: poki │  │ch: caed │
         └────┬────┘  └────┬────┘  └────┬────┘
              │            │            │
              ▼            ▼            ▼
         Twitch IRC   Twitch IRC   YouTube Chat
         Analyzer     Analyzer     Analyzer
         Highlight    Highlight    Highlight
              │            │            │
              └────────────┼────────────┘
                           │ write
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    └─────────────┘
```

#### Worker 生命週期

```
1. CREATED
   Trigger Service 偵測到使用者的頻道開台
   → 建立 job: { userId, channelId, platform, channelName }
   → 推入 Redis queue

2. STARTING
   Worker Pool 中一個空閒 worker 認領 job
   → 建立 Collector（Twitch IRC 或 YouTube Chat）
   → 建立 Analyzer + HighlightDetector
   → 建立 DB session 記錄
   → 連線到目標頻道

3. RUNNING
   持續運作，每秒：
   - Collector 收到 ChatMessage → feed 給 Analyzer
   - Analyzer emit snapshot → 寫 DB + 推 WebSocket（給前端即時顯示）
   - HighlightDetector 偵測到高光 → 寫 DB + 推通知

4. STOPPING
   觸發條件（任一）：
   - Twitch EventSub 收到 stream.offline
   - YouTube API 回報直播結束
   - 使用者手動停止
   - 連線斷開超過重連上限
   - Server 收到 shutdown signal

   → 停止 Collector
   → 等待最後一批 snapshot 寫入
   → 結束 DB session（endSession）
   → 產生場次摘要
   → 釋放 worker 資源

5. COMPLETED
   Worker 回到 idle pool，等待下一個 job
```

#### Worker 內部結構（單一 worker）

```typescript
interface ChannelWorker {
  // 識別
  jobId: string;
  userId: string;
  channelId: string;
  platform: 'twitch' | 'youtube';
  status: 'starting' | 'running' | 'stopping' | 'error';

  // 核心元件（複用現有模組）
  collector: TwitchCollector | YouTubeCollector;
  analyzer: RulesAnalyzer | LLMAnalyzer;
  detector: HighlightDetector;

  // 狀態
  sessionId: string;          // DB session UUID
  startedAt: Date;
  messageCount: number;
  highlightCount: number;
  lastSnapshotAt: number;

  // 方法
  start(): Promise<void>;
  stop(reason: string): Promise<void>;
  getStatus(): WorkerStatus;
}
```

#### Worker Pool 管理

```typescript
class WorkerPool {
  private workers: Map<string, ChannelWorker>;  // jobId → worker
  private maxConcurrent: number;                 // 單台 server 最大同時 worker 數

  // 資源管理
  // 每個 worker 大約消耗：
  //   - 1 條 TCP 連線（Twitch IRC）
  //   - ~20MB RAM（Analyzer 滑動視窗 + 緩衝區）
  //   - 極少 CPU（規則引擎很輕量）
  //
  // 一台 4GB VPS 大約能跑 100-150 個 worker 同時
  // 瓶頸在 TCP 連線數和 DB 寫入 throughput

  async spawn(job: ChannelJob): Promise<void> {
    if (this.workers.size >= this.maxConcurrent) {
      throw new Error('Worker pool full');
    }
    const worker = new ChannelWorker(job);
    this.workers.set(job.id, worker);
    await worker.start();
  }

  async kill(jobId: string, reason: string): Promise<void> {
    const worker = this.workers.get(jobId);
    if (worker) {
      await worker.stop(reason);
      this.workers.delete(jobId);
    }
  }

  // 健康檢查：定期檢查每個 worker 是否還活著
  healthCheck(): void {
    for (const [id, worker] of this.workers) {
      if (worker.status === 'error') {
        this.kill(id, 'health check failed');
      }
    }
  }
}
```

#### DB 寫入策略（高 throughput）

```
問題：100 個 worker × 每秒 1 筆 snapshot = 100 writes/sec
     加上 chat messages 可能更多

解法：批次寫入
```

```typescript
class BatchWriter {
  private buffer: Snapshot[] = [];
  private flushInterval = 5000;  // 每 5 秒 flush 一次

  add(snapshot: Snapshot): void {
    this.buffer.push(snapshot);
  }

  // 定期批次寫入（一次 INSERT 100 筆比 100 次 INSERT 1 筆快 50 倍）
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);

    // PostgreSQL COPY 或 multi-row INSERT
    await db.query(`
      INSERT INTO snapshots (session_id, timestamp, dominant, scores, intensity, msg_count)
      VALUES ${batch.map(s => `(${s.sessionId}, ${s.timestamp}, ...)`).join(',')}
    `);
  }
}
```

#### 即時推送（WebSocket fanout）

```
使用者開啟 Dashboard 的即時監控頁面時：

1. 前端建立 WebSocket 連線到 API server
2. 告訴 server：「我要看 channel X 的即時資料」
3. Server 訂閱該 channel 的 worker 推送
4. Worker 每秒 emit snapshot → Redis Pub/Sub → API server → WebSocket → 前端

用 Redis Pub/Sub 是因為：
- API server 可能有多台（load balancer 後面）
- Worker 和 API server 可能不在同一台機器
- Pub/Sub 天然支援 fanout（多個前端訂閱同一頻道）
```

```
Worker ──publish──▶ Redis channel: "live:xqc"
                          │
                    ┌─────┼─────┐
                    ▼     ▼     ▼
                  API-1  API-2  API-3
                    │     │     │
                    ▼     ▼     ▼
                  WS-1  WS-2  WS-3  ← 各自連線的前端使用者
```

#### 錯誤處理與容錯

| 情境 | 處理方式 |
|------|----------|
| Twitch IRC 斷線 | 指數退避重連（複用現有邏輯），3 次失敗後標記 error |
| YouTube API quota 耗盡 | 暫停該 worker，等到隔天 quota 重置 |
| Worker crash | WorkerPool healthCheck 偵測 → 重新排 job |
| DB 寫入失敗 | BatchWriter 保留 buffer，retry 3 次，持續失敗則暫存到 Redis |
| Server 重啟 | Redis queue 裡的 job 不會丟失，重啟後自動 re-consume |
| 使用者刪帳號 | Trigger Service 發 kill signal → worker 優雅關閉 → 清除資料 |

#### 擴展策略

```
階段 1（0-100 使用者）：
  單台 VPS，API + Worker + Redis + PG 全在一起
  Docker Compose 部署

階段 2（100-1000 使用者）：
  分離：API server × 2 + Worker server × 2 + Redis + PG
  Worker server 專門跑 collector + analyzer

階段 3（1000+ 使用者）：
  Kubernetes，Worker 用 HPA 自動擴展
  PG 用 read replica
  Redis Cluster
  snapshot 資料考慮 TimescaleDB
```

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

### P3-3 — 通知系統
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
| M9 | 通知系統 + Discord Webhook | 1 session |

## 風險與注意事項

1. **YouTube API Quota** — 免費額度有限，需要智慧 polling 策略
2. **Twitch IRC 規模** — 大型頻道（>50k 觀眾）訊息量極大，worker 需要能處理
3. **資料量** — 逐秒快照每場 3,600 筆，100 位用戶 × 30 場/月 = 10.8M 筆/月 → 需要分區或定期清理
4. **GDPR** — 儲存使用者資料需要隱私政策和刪除機制
5. **OAuth Token 刷新** — 需要背景 job 定期刷新 token，避免斷線
6. **成本** — PostgreSQL + Redis + Worker 至少需要一台 VPS（$20/mo 起）

---

_Made with 🍂 by aki-terminal-leaf_
