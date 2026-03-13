# Chat Mood Meter — 開發計畫

## 概要

即時聊天情緒熱力儀表板 + 自動高光標記系統。
把觀眾的情緒「視覺化」成 overlay，同時自動標記精華時段。

## 架構

```
[Twitch IRC / YT Chat API]
        ↓
   Message Collector
        ↓
   Emotion Analyzer (規則引擎 + 可選 LLM)
        ↓
   ┌─────────────┬──────────────┐
   │             │              │
 Overlay      Highlight      Storage
 (WebSocket)  Detector       (SQLite)
   │             │
 OBS Browser   OBS WebSocket
 Source         (打時間戳)
```

## 模組拆分

### Phase 1：核心（MVP，目標 1 週）

**M1 — Message Collector**
- Twitch: tmi.js 接 IRC
- YouTube: googleapis/youtube live chat polling
- 統一輸出格式：`{ platform, user, text, emotes, timestamp }`
- 用 WebSocket server 對內廣播

**M2 — Emotion Analyzer**
- 規則引擎（先做這個，夠用就不接 LLM）：
  - 表情符號權重表（😂=joy:0.8, PogChamp=hype:1.0, BibleThump=sad:0.7...）
  - 關鍵詞清單（中/英/日）
  - 訊息密度加權（短時間大量訊息 = 興奮）
- 情緒分類：`hype` / `funny` / `sad` / `angry` / `neutral`
- 輸出：每秒一次情緒快照 `{ dominant, scores: {hype, funny, sad, angry}, intensity }`

**M3 — Overlay（OBS Browser Source）**
- 單一 HTML 檔（或 localhost:port）
- Canvas 繪製即時波形圖（最近 5 分鐘）
- 右上角氣泡顯示當前主要情緒 + emoji
- 可調整大小、位置、透明度
- 配色：深色半透明背景，不干擾畫面

### Phase 2：高光系統（目標 +3 天）

**M4 — Highlight Detector**
- 滑動視窗 30 秒
- 觸發條件（可調）：
  - 訊息密度 > 平均值 × 2.5
  - 情緒強度 > 0.8
  - 特定關鍵詞密度暴增（CLIP, ?, POG 等）
- 觸發時：
  - 呼叫 OBS WebSocket API 建立 chapter marker
  - 記錄到 SQLite：`{ timestamp, emotion, intensity, sample_messages }`

**M5 — Storage & Export**
- SQLite 一場一張表
- 記錄：逐秒情緒快照 + 高光標記
- 導出：
  - JSON（給自動剪片工具）
  - CSV（給試算表分析）
  - 情緒時間軸 HTML 報告（直播結束後可直接開）

### Phase 3：進階（可選）

**M6 — LLM 情緒分析**
- 替代規則引擎，接 local LLM（Ollama）或 Gemini API
- 批次處理（每 10 秒收集一批訊息，一次分析）
- 好處：理解語境、梗、反串

**M7 — Dashboard Web UI**
- 歷史直播回顧
- 跨場次情緒趨勢
- 觀眾活躍度排行

## 技術選型

| 項目 | 選擇 | 原因 |
|------|------|------|
| 語言 | TypeScript (Node.js) | tmi.js 生態、前後端統一 |
| Twitch 接入 | tmi.js | 成熟穩定 |
| YouTube 接入 | googleapis | 官方 SDK |
| WebSocket | ws | 輕量 |
| Overlay | 純 HTML + Canvas | OBS Browser Source 相容性最好 |
| OBS 控制 | obs-websocket-js | OBS WebSocket 5.x |
| DB | better-sqlite3 | 零設定、嵌入式 |
| 打包 | esbuild | 快 |

## 檔案結構

```
chat-mood-meter/
├── src/
│   ├── collector/        # M1: 訊息收集
│   │   ├── twitch.ts
│   │   ├── youtube.ts
│   │   └── types.ts
│   ├── analyzer/         # M2: 情緒分析
│   │   ├── rules.ts      # 規則引擎
│   │   ├── emote-map.ts  # 表情符號權重
│   │   └── types.ts
│   ├── highlight/        # M4: 高光偵測
│   │   └── detector.ts
│   ├── storage/          # M5: SQLite
│   │   └── db.ts
│   ├── server.ts         # WebSocket server
│   └── index.ts          # 入口
├── overlay/              # M3: OBS overlay
│   ├── index.html
│   ├── mood-meter.js
│   └── style.css
├── config/
│   └── default.json      # 平台 token、閾值設定
├── package.json
├── tsconfig.json
└── README.md
```

## 設定檔範例

```json
{
  "platforms": {
    "twitch": {
      "enabled": true,
      "channel": "your_channel",
      "token": "oauth:xxx"
    },
    "youtube": {
      "enabled": false,
      "liveChatId": ""
    }
  },
  "analyzer": {
    "mode": "rules",
    "snapshotIntervalMs": 1000
  },
  "highlight": {
    "windowSec": 30,
    "densityMultiplier": 2.5,
    "intensityThreshold": 0.8
  },
  "overlay": {
    "port": 9800,
    "historyMinutes": 5
  },
  "obs": {
    "enabled": true,
    "host": "localhost",
    "port": 4455,
    "password": ""
  },
  "storage": {
    "dbPath": "./data/sessions.db"
  }
}
```

## 開發順序

```
Session 1（~3hr）:
  M1 (Twitch collector + WebSocket server)
  M2 (規則引擎 + 表情符號映射)
  M3 (Overlay 前端)
  → MVP: OBS 即時情緒波形

Session 2（~3hr）:
  M4 (高光偵測 + OBS marker)
  M5 (SQLite + 導出)
  → 完整版: 自動標記 + 事後回顧

Session 3（可選）:
  M6 (LLM 分析) — 視需求
  M7 (Dashboard) — 視需求
```

## 風險與對策

| 風險 | 對策 |
|------|------|
| Twitch IRC 斷線 | tmi.js 內建 reconnect，加 exponential backoff |
| YouTube API 配額限制 | polling interval 最低 5 秒，做 rate limit 保護 |
| OBS WebSocket 版本不相容 | 鎖定 obs-websocket-js 5.x，README 註明最低 OBS 版本 |
| 表情符號映射不全 | 用 7TV/BTTV/FFZ API 動態載入第三方表情 |
| 高光誤判 | 閾值可調 + 冷卻時間（同一情緒 60 秒內不重複觸發）|
