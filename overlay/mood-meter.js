/**
 * Chat Mood Meter — OBS Overlay 主邏輯
 * M3 模組：WebSocket 連接 + Canvas 波形圖 + HUD 顯示
 *
 * 資料流：
 *   WebSocket → EmotionSnapshot / HighlightMarker
 *   → 歷史佇列 → Canvas 繪製 + DOM 更新
 *
 * 純 Vanilla JS，不依賴任何框架或建置工具
 */

'use strict';

// ──────────────────────────────────────────────
// 1. 從 URL 參數讀取設定
// ──────────────────────────────────────────────

const urlParams = new URLSearchParams(window.location.search);

/** WebSocket 連接埠，預設 9800 */
const WS_PORT = parseInt(urlParams.get('port') || '9800', 10);

/** WebSocket host，預設使用當前頁面的 host（支援 tunnel） */
const WS_HOST = urlParams.get('wsHost') || window.location.hostname || 'localhost';

/** WebSocket 協定，HTTPS 時自動用 wss */
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

/** 完整 WebSocket URL（tunnel 時用 443/不帶 port，本地時用指定 port） */
const WS_URL = window.location.hostname && window.location.hostname !== 'localhost'
  ? `${WS_PROTOCOL}//${WS_HOST}`
  : `ws://${WS_HOST}:${WS_PORT}`;

/** 波形圖顯示歷史分鐘數，預設 5 分鐘 */
const HISTORY_MINUTES = parseFloat(urlParams.get('history') || '5');

/** 波形圖保留的最大快照數（每秒一筆，N 分鐘 = N*60 筆） */
const MAX_SNAPSHOTS = Math.ceil(HISTORY_MINUTES * 60);

// ──────────────────────────────────────────────
// 2. 情緒顏色與 Emoji 定義
// ──────────────────────────────────────────────

/**
 * 各情緒對應的視覺設定
 * @type {Record<string, {emoji: string, color: string, gradStart: string, gradEnd: string, glow: string}>}
 */
const EMOTION_CONFIG = {
  hype:    { emoji: '🔥', color: '#ff6b35', gradStart: '#ff4500', gradEnd: '#ff9f43', glow: 'rgba(255, 107, 53, 0.5)' },
  funny:   { emoji: '😂', color: '#ffd700', gradStart: '#ffb700', gradEnd: '#fff176', glow: 'rgba(255, 215, 0, 0.45)' },
  sad:     { emoji: '😢', color: '#5c9bd6', gradStart: '#2563eb', gradEnd: '#93c5fd', glow: 'rgba(92, 155, 214, 0.45)' },
  angry:   { emoji: '😡', color: '#ef4444', gradStart: '#b91c1c', gradEnd: '#fca5a5', glow: 'rgba(239, 68, 68, 0.45)' },
  neutral: { emoji: '😐', color: '#9ca3af', gradStart: '#6b7280', gradEnd: '#d1d5db', glow: 'rgba(156, 163, 175, 0.3)' },
};

// ──────────────────────────────────────────────
// 3. DOM 元素取得
// ──────────────────────────────────────────────

const overlay       = document.getElementById('mood-overlay');
const canvas        = document.getElementById('waveform-canvas');
const ctx           = canvas.getContext('2d');
const emojiEl       = document.getElementById('emotion-emoji');
const intensityFill = document.getElementById('intensity-fill');
const intensityLabel= document.getElementById('intensity-label');
const msgRateValue  = document.getElementById('msg-rate-value');
const connDot       = document.getElementById('connection-dot');
const flashEl       = document.getElementById('highlight-flash');

// ──────────────────────────────────────────────
// 4. 全域狀態
// ──────────────────────────────────────────────

/** 歷史快照佇列，最多 MAX_SNAPSHOTS 筆 @type {Array<import('../src/types').EmotionSnapshot>} */
const snapshotHistory = [];

/** 目前顯示的主要情緒 */
let currentEmotion = 'neutral';

/** WebSocket 實例 */
let ws = null;

/** 重連計時器 ID */
let reconnectTimer = null;

/** 當前重連延遲（ms），指數退避 */
let reconnectDelay = 1000;

/** 動畫呼吸相位（0~2π 循環，用於波形漸層閃動） */
let breathPhase = 0;

/** 上一次訊息速率計算時間 */
let lastMsgRateTimestamp = Date.now();

/** 累積訊息數（用於計算 msg/s） */
let msgCountAccum = 0;

/** 顯示中的 msg/s */
let displayedMsgRate = 0;

// ──────────────────────────────────────────────
// 5. WebSocket 連接與重連
// ──────────────────────────────────────────────

/**
 * 建立 WebSocket 連線
 * 包含指數退避自動重連
 */
function connect() {
  // 清除已有的重連計時器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  setConnectionState('connecting');

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.error('[MoodMeter] WebSocket 建立失敗：', err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    console.log(`[MoodMeter] 已連線 ${WS_URL}`);
    setConnectionState('connected');
    // 連線成功，重置退避延遲
    reconnectDelay = 1000;
  });

  ws.addEventListener('message', (event) => {
    try {
      const wsEvent = JSON.parse(event.data);
      handleWSEvent(wsEvent);
    } catch (err) {
      console.warn('[MoodMeter] 無法解析 WebSocket 訊息：', err);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[MoodMeter] WebSocket 斷線，等待重連...');
    setConnectionState('disconnected');
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener('error', (err) => {
    console.error('[MoodMeter] WebSocket 錯誤：', err);
    // error 後通常會觸發 close，不需額外處理
  });
}

/**
 * 安排重連（指數退避，最大 30 秒）
 */
function scheduleReconnect() {
  const delay = Math.min(reconnectDelay, 30000);
  console.log(`[MoodMeter] ${delay}ms 後重連...`);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, delay);
}

/**
 * 更新連線狀態指示點
 * @param {'connecting'|'connected'|'disconnected'} state
 */
function setConnectionState(state) {
  connDot.className = state;
}

// ──────────────────────────────────────────────
// 6. 事件處理
// ──────────────────────────────────────────────

/**
 * 處理收到的 WebSocket 事件
 * @param {{ type: string, data: any }} event
 */
function handleWSEvent(event) {
  switch (event.type) {
    case 'snapshot':
      handleSnapshot(event.data);
      break;
    case 'highlight':
      handleHighlight(event.data);
      break;
    case 'chat':
      // chat 事件用於累計訊息速率
      msgCountAccum++;
      break;
    default:
      // 忽略未知事件
  }
}

/**
 * 處理情緒快照
 * @param {import('../src/types').EmotionSnapshot} snapshot
 */
function handleSnapshot(snapshot) {
  // 加入歷史佇列，超過上限則移除最舊的
  snapshotHistory.push(snapshot);
  if (snapshotHistory.length > MAX_SNAPSHOTS) {
    snapshotHistory.shift();
  }

  // 更新 HUD 右側資訊
  updateInfoPanel(snapshot);
}

/**
 * 處理高光標記事件 — 觸發閃爍特效
 * @param {import('../src/types').HighlightMarker} marker
 */
function handleHighlight(marker) {
  console.log(`[MoodMeter] 高光事件！emotion=${marker.emotion} intensity=${marker.intensity.toFixed(2)}`);

  // 移除再加，確保動畫可重複觸發
  flashEl.classList.remove('flashing');
  overlay.classList.remove('highlight-active');

  // 根據情緒調整閃光顏色
  const cfg = EMOTION_CONFIG[marker.emotion] || EMOTION_CONFIG.neutral;
  flashEl.style.background = `radial-gradient(
    ellipse at center,
    ${cfg.glow.replace('0.45', '0.35')} 0%,
    ${cfg.glow.replace('0.45', '0.20')} 40%,
    transparent 70%
  )`;

  // 強制 reflow 讓動畫重新觸發
  void flashEl.offsetWidth;
  void overlay.offsetWidth;

  flashEl.classList.add('flashing');
  overlay.classList.add('highlight-active');

  // 動畫結束後移除 class
  const duration = 1200;
  setTimeout(() => {
    flashEl.classList.remove('flashing');
    overlay.classList.remove('highlight-active');
  }, duration);
}

// ──────────────────────────────────────────────
// 7. HUD 資訊面板更新
// ──────────────────────────────────────────────

/**
 * 更新右側資訊面板（emoji、強度、訊息速率）
 * @param {import('../src/types').EmotionSnapshot} snapshot
 */
function updateInfoPanel(snapshot) {
  const { dominant, intensity } = snapshot;
  const cfg = EMOTION_CONFIG[dominant] || EMOTION_CONFIG.neutral;

  // ── 情緒切換時才更新 emoji（加彈跳動畫）
  if (dominant !== currentEmotion) {
    currentEmotion = dominant;

    // 彈跳動畫
    emojiEl.classList.remove('bouncing');
    void emojiEl.offsetWidth; // 強制 reflow
    emojiEl.textContent = cfg.emoji;
    emojiEl.classList.add('bouncing');

    // 動畫結束後移除 class，讓下次可再觸發
    emojiEl.addEventListener('animationend', () => {
      emojiEl.classList.remove('bouncing');
    }, { once: true });

    // 更新 CSS 變數（情緒主題色）
    overlay.style.setProperty('--emotion-glow', cfg.glow);
    overlay.style.setProperty('--emotion-color-start', cfg.gradStart);
    overlay.style.setProperty('--emotion-color-end', cfg.gradEnd);
  }

  // ── 強度百分比
  const pct = Math.round(intensity * 100);
  intensityFill.style.width = `${pct}%`;
  intensityLabel.textContent = `${pct}%`;
}

// ──────────────────────────────────────────────
// 8. 訊息速率計算（每秒更新一次）
// ──────────────────────────────────────────────

/**
 * 每秒計算並更新 msg/s 顯示
 */
function updateMsgRate() {
  const now = Date.now();
  const elapsed = (now - lastMsgRateTimestamp) / 1000;
  if (elapsed >= 1) {
    displayedMsgRate = Math.round(msgCountAccum / elapsed);
    msgCountAccum = 0;
    lastMsgRateTimestamp = now;

    msgRateValue.textContent = displayedMsgRate.toString();

    // 高速時文字加亮
    if (displayedMsgRate >= 10) {
      msgRateValue.style.color = '#ffd700';
    } else if (displayedMsgRate >= 5) {
      msgRateValue.style.color = '#90caf9';
    } else {
      msgRateValue.style.color = '#e0e0e0';
    }
  }
}

// ──────────────────────────────────────────────
// 9. Canvas 波形圖繪製
// ──────────────────────────────────────────────

/**
 * 調整 Canvas 尺寸以符合容器
 */
function resizeCanvas() {
  // 取得 overlay 實際寬高
  const rect = overlay.getBoundingClientRect();
  const infoPanelWidth = 88; // 對應 CSS #info-panel width
  const w = Math.max(rect.width - infoPanelWidth, 50);
  const h = Math.max(rect.height, 50);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = Math.round(w);
    canvas.height = Math.round(h);
  }
}

/**
 * 主繪製函式，每幀呼叫
 */
function drawFrame() {
  resizeCanvas();

  const W = canvas.width;
  const H = canvas.height;

  // 清除畫面
  ctx.clearRect(0, 0, W, H);

  if (snapshotHistory.length === 0) {
    // 尚無資料時，顯示等待文字
    drawIdleState(W, H);
    return;
  }

  // 繪製網格底線
  drawGrid(W, H);

  // 繪製各情緒波形（按覆蓋順序）
  const emotions = ['neutral', 'sad', 'angry', 'funny', 'hype'];
  for (const emotion of emotions) {
    drawEmotionWave(W, H, emotion);
  }

  // 繪製 dominant 情緒高亮線
  drawDominantLine(W, H);
}

/**
 * 無資料時的等待畫面
 */
function drawIdleState(W, H) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CONNECTING...', W / 2, H / 2);
}

/**
 * 繪製背景網格（X 軸時間刻度線）
 */
function drawGrid(W, H) {
  const lineCount = 5; // 水平分隔線數量

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;

  for (let i = 1; i < lineCount; i++) {
    const y = Math.round(H * (i / lineCount));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // 底部基線（稍亮）
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H - 1);
  ctx.lineTo(W, H - 1);
  ctx.stroke();
}

/**
 * 繪製單一情緒的波形填充
 * @param {number} W canvas 寬
 * @param {number} H canvas 高
 * @param {string} emotion 情緒名稱
 */
function drawEmotionWave(W, H, emotion) {
  const cfg = EMOTION_CONFIG[emotion];
  if (!cfg) return;

  const n = snapshotHistory.length;
  if (n === 0) return;

  // 呼吸感：sin 波讓不透明度微幅震盪
  const breathAlpha = 0.55 + Math.sin(breathPhase + getEmotionPhaseOffset(emotion)) * 0.08;

  // 建立路徑（從左到右，依時間順序）
  ctx.beginPath();
  ctx.moveTo(0, H); // 左下角起始

  for (let i = 0; i < n; i++) {
    const snap = snapshotHistory[i];
    const x = (i / (MAX_SNAPSHOTS - 1)) * W;

    // intensity * emotion score 決定高度
    const score = snap.dominant === emotion ? snap.intensity : (snap.scores[emotion] || 0);
    const y = H - (score * H * 0.85) - 2; // 留 2px 底部間距

    if (i === 0) {
      ctx.moveTo(x, H);
      ctx.lineTo(x, y);
    } else {
      // 平滑曲線：用 bezier 曲線讓波形柔和
      const prevSnap = snapshotHistory[i - 1];
      const prevX = ((i - 1) / (MAX_SNAPSHOTS - 1)) * W;
      const prevScore = prevSnap.dominant === emotion ? prevSnap.intensity : (prevSnap.scores[emotion] || 0);
      const prevY = H - (prevScore * H * 0.85) - 2;

      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
    }
  }

  // 回到底部，形成封閉路徑
  const lastX = ((n - 1) / (MAX_SNAPSHOTS - 1)) * W;
  ctx.lineTo(lastX, H);
  ctx.closePath();

  // 漸層填充（上深下淺，有透明感）
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   hexToRgba(cfg.color, breathAlpha));
  grad.addColorStop(0.5, hexToRgba(cfg.color, breathAlpha * 0.6));
  grad.addColorStop(1,   hexToRgba(cfg.color, 0.05));

  ctx.fillStyle = grad;
  ctx.fill();
}

/**
 * 繪製 dominant 情緒的高亮頂線（增加清晰度）
 */
function drawDominantLine(W, H) {
  const n = snapshotHistory.length;
  if (n < 2) return;

  const currentSnap = snapshotHistory[n - 1];
  const emotion = currentSnap.dominant;
  const cfg = EMOTION_CONFIG[emotion] || EMOTION_CONFIG.neutral;

  ctx.beginPath();

  for (let i = 0; i < n; i++) {
    const snap = snapshotHistory[i];
    const x = (i / (MAX_SNAPSHOTS - 1)) * W;
    const y = H - (snap.intensity * H * 0.85) - 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevSnap = snapshotHistory[i - 1];
      const prevX = ((i - 1) / (MAX_SNAPSHOTS - 1)) * W;
      const prevY = H - (prevSnap.intensity * H * 0.85) - 2;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
    }
  }

  // 發光頂線
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = 2;
  ctx.shadowColor = cfg.color;
  ctx.shadowBlur = 8;
  ctx.stroke();

  // 重設 shadow
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/**
 * 各情緒的呼吸相位偏移，讓不同情緒的呼吸動畫錯開
 * @param {string} emotion
 * @returns {number}
 */
function getEmotionPhaseOffset(emotion) {
  const offsets = { hype: 0, funny: 1.2, sad: 2.4, angry: 3.6, neutral: 4.8 };
  return offsets[emotion] || 0;
}

// ──────────────────────────────────────────────
// 10. 工具函式
// ──────────────────────────────────────────────

/**
 * 將 hex 色碼轉為 rgba 字串
 * @param {string} hex  例如 '#ff6b35'
 * @param {number} alpha 0~1
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// ──────────────────────────────────────────────
// 11. 主動畫迴圈
// ──────────────────────────────────────────────

/** 上一幀的時間戳 */
let lastFrameTime = 0;

/**
 * requestAnimationFrame 主迴圈
 * @param {number} timestamp
 */
function animationLoop(timestamp) {
  const delta = (timestamp - lastFrameTime) / 1000; // 秒
  lastFrameTime = timestamp;

  // 推進呼吸相位（約每 3 秒一個週期）
  breathPhase = (breathPhase + delta * 2.1) % (Math.PI * 2);

  // 更新訊息速率
  updateMsgRate();

  // 繪製波形
  drawFrame();

  requestAnimationFrame(animationLoop);
}

// ──────────────────────────────────────────────
// 12. 初始化
// ──────────────────────────────────────────────

/**
 * 頁面載入後啟動
 */
function init() {
  console.log(`[MoodMeter] 初始化 | port=${WS_PORT} | history=${HISTORY_MINUTES}min | maxSnapshots=${MAX_SNAPSHOTS}`);

  // 設定初始 emoji
  emojiEl.textContent = EMOTION_CONFIG.neutral.emoji;

  // 設定初始 CSS 情緒變數
  overlay.style.setProperty('--emotion-glow', EMOTION_CONFIG.neutral.glow);
  overlay.style.setProperty('--emotion-color-start', EMOTION_CONFIG.neutral.gradStart);
  overlay.style.setProperty('--emotion-color-end', EMOTION_CONFIG.neutral.gradEnd);

  // 啟動 WebSocket 連線
  connect();

  // 啟動動畫迴圈
  requestAnimationFrame(animationLoop);
}

// 等 DOM 完全就緒後初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
