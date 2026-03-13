# 🎭 Chat Mood Meter

即時分析直播聊天室情緒、自動偵測精華時刻的工具。

支援 Twitch 和 YouTube Live，將聊天室的情緒變化視覺化，
並在高光時刻自動建立標記 — 讓事後剪輯不再漏掉精彩片段。

## ✨ Features

- **即時情緒分析** — 每秒分析聊天訊息，辨識 hype / funny / sad / angry / neutral
- **自動高光偵測** — 情緒密度突增時自動標記，可設定靈敏度
- **6 種導出格式** — JSON / CSV / EDL / YouTube Chapters / SRT / HTML
- **Web Dashboard** — Grafana 風格深色介面，即時監控 + 歷史回顧
- **WebSocket 即時推送** — 前端即時更新情緒曲線
- **多頻道支援** — 一個帳號管理多個直播頻道
- **OAuth 登入** — Twitch / YouTube 一鍵登入
- **Webhook 通知** — 高光發生時即時推送到自訂端點或 Discord

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────┐     ┌───────────┐
│  React SPA  │◄────│ Fastify  │◄────│  Worker   │
│  (Vite)     │ WS  │  API     │     │  Pool     │
└─────────────┘     └────┬─────┘     └─────┬─────┘
                         │                  │
                    ┌────┴────┐       ┌────┴────┐
                    │PostgreSQL│       │  Redis  │
                    │ Drizzle  │       │ BullMQ  │
                    └─────────┘       └─────────┘
```

## 📦 Packages

| Package | Description |
|---------|-------------|
| `packages/core` | 共用型別定義（EmotionSnapshot, HighlightMarker） |
| `packages/collector` | Twitch/YouTube 聊天收集器 |
| `packages/db` | Drizzle ORM schema + PostgreSQL |
| `packages/export` | 6 種導出格式 |
| `apps/api` | Fastify REST API + WebSocket |
| `apps/worker` | ChannelWorker + WorkerPool + BullMQ |
| `apps/web` | React + Vite Dashboard |

## 🚀 Quick Start

### Docker（推薦）

```bash
cp .env.example .env
# 編輯 .env 填入 OAuth credentials
docker compose up -d
```

服務啟動後：

- **Dashboard** → http://localhost:5173
- **API** → http://localhost:3000

### Development

```bash
npm install
# 需要 PostgreSQL 16 + Redis
npx turbo run test

# 分開啟動
npm run dev:api
npm run dev:web
npm run dev:worker
```

## 📊 Export Formats

| Format | Use Case |
|--------|----------|
| JSON | 通用資料交換 |
| CSV | Excel / Google Sheets |
| EDL | Premiere Pro / DaVinci Resolve |
| Chapters | YouTube 影片章節 |
| SRT | 字幕軟體 |
| HTML | 獨立報告（含圖表） |

## 🔔 Webhook 通知

高光發生時，可自動推送到任意 HTTP 端點。

```bash
# 建立 webhook
curl -X POST http://localhost:3000/api/webhooks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "url": "https://your-server.com/hook",
    "events": ["highlight.created", "session.started", "session.ended"]
  }'
```

支援的事件：

| Event | 觸發時機 |
|-------|---------|
| `highlight.created` | 偵測到高光時刻 |
| `session.started` | 開始監控頻道 |
| `session.ended` | 監控結束 |

Discord Webhook 也直接支援，payload 會自動格式化為漂亮的 Embed。

## 🔧 Configuration

環境變數見 `.env.example`

## 📝 License

MIT
