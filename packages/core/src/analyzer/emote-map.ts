/**
 * emote-map.ts
 * 表情符號 → 情緒映射表
 *
 * 涵蓋三大語系 + Unicode emoji，共 100+ 條目。
 * scores 四維度：hype（炒氣）、funny（搞笑）、sad（悲傷）、angry（憤怒）
 * weight：該 emote 的情緒強度權重（0-1）
 */

import type { EmotionScores } from '../types.js';

export interface EmoteEntry {
  scores: EmotionScores;
  weight: number;
}

export type EmoteMap = Record<string, EmoteEntry>;

// ─────────────────────────────────────────────
// 歐美 Twitch / 通用直播表情
// ─────────────────────────────────────────────
const twitchEmotes: EmoteMap = {
  // 興奮 / 震驚
  PogChamp:       { scores: { hype: 1.0, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.9 },
  Pog:            { scores: { hype: 0.9, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  POGGERS:        { scores: { hype: 0.9, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  PogO:           { scores: { hype: 0.8, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  GIGACHAD:       { scores: { hype: 0.9, funny: 0.5, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  HeyGuys:        { scores: { hype: 0.6, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.5 },
  Kreygasm:       { scores: { hype: 0.8, funny: 0.4, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  catJAM:         { scores: { hype: 0.7, funny: 0.6, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  EZ:             { scores: { hype: 0.5, funny: 0.5, sad: 0.0, angry: 0.1 }, weight: 0.6 },
  Clap:           { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  PauseChamp:     { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  TriHard:        { scores: { hype: 0.6, funny: 0.4, sad: 0.0, angry: 0.0 }, weight: 0.55 },

  // 搞笑 / 嘲諷
  Kappa:          { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  KappaHD:        { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  KappaPride:     { scores: { hype: 0.2, funny: 0.7, sad: 0.0, angry: 0.0 }, weight: 0.65 },
  LUL:            { scores: { hype: 0.3, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  LULW:           { scores: { hype: 0.3, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  KEKW:           { scores: { hype: 0.3, funny: 1.0, sad: 0.0, angry: 0.0 }, weight: 0.9 },
  OMEGALUL:       { scores: { hype: 0.2, funny: 1.0, sad: 0.0, angry: 0.0 }, weight: 0.9 },
  pepeLaugh:      { scores: { hype: 0.2, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  FeelsGoodMan:   { scores: { hype: 0.5, funny: 0.4, sad: 0.0, angry: 0.0 }, weight: 0.65 },
  forsenCD:       { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.1 }, weight: 0.6 },
  HAHAA:          { scores: { hype: 0.2, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  OmegaLUL:       { scores: { hype: 0.2, funny: 0.95, sad: 0.0, angry: 0.0 }, weight: 0.88 },

  // 悲傷 / 同情
  BibleThump:     { scores: { hype: 0.0, funny: 0.1, sad: 0.9, angry: 0.0 }, weight: 0.85 },
  FeelsBadMan:    { scores: { hype: 0.0, funny: 0.1, sad: 0.8, angry: 0.1 }, weight: 0.8 },
  Sadge:          { scores: { hype: 0.0, funny: 0.1, sad: 0.9, angry: 0.0 }, weight: 0.85 },
  PepeHands:      { scores: { hype: 0.0, funny: 0.1, sad: 0.85, angry: 0.0 }, weight: 0.8 },
  PepeHappy:      { scores: { hype: 0.4, funny: 0.3, sad: 0.1, angry: 0.0 }, weight: 0.65 },
  PepeS:          { scores: { hype: 0.0, funny: 0.2, sad: 0.7, angry: 0.1 }, weight: 0.7 },
  Crying:         { scores: { hype: 0.0, funny: 0.0, sad: 0.9, angry: 0.0 }, weight: 0.8 },
  WAYTOODANK:     { scores: { hype: 0.0, funny: 0.2, sad: 0.7, angry: 0.1 }, weight: 0.65 },

  // 緊張 / 不安
  monkaS:         { scores: { hype: 0.3, funny: 0.2, sad: 0.2, angry: 0.0 }, weight: 0.75 },
  monkaW:         { scores: { hype: 0.2, funny: 0.1, sad: 0.3, angry: 0.0 }, weight: 0.7 },
  monkaHmm:       { scores: { hype: 0.1, funny: 0.3, sad: 0.1, angry: 0.0 }, weight: 0.55 },
  monkaOMEGA:     { scores: { hype: 0.4, funny: 0.2, sad: 0.2, angry: 0.0 }, weight: 0.7 },
  WeirdChamp:     { scores: { hype: 0.1, funny: 0.5, sad: 0.0, angry: 0.2 }, weight: 0.6 },

  // 憤怒 / 失望
  NotLikeThis:    { scores: { hype: 0.0, funny: 0.2, sad: 0.4, angry: 0.5 }, weight: 0.75 },
  BabyRage:       { scores: { hype: 0.1, funny: 0.3, sad: 0.1, angry: 0.7 }, weight: 0.7 },
  'D:':           { scores: { hype: 0.1, funny: 0.2, sad: 0.3, angry: 0.5 }, weight: 0.7 },
  TriFi:          { scores: { hype: 0.0, funny: 0.1, sad: 0.2, angry: 0.7 }, weight: 0.7 },
  COPIUM:         { scores: { hype: 0.0, funny: 0.5, sad: 0.5, angry: 0.2 }, weight: 0.75 },
  HOPIUM:         { scores: { hype: 0.6, funny: 0.3, sad: 0.1, angry: 0.0 }, weight: 0.65 },
  ResidentSleeper:{ scores: { hype: 0.0, funny: 0.3, sad: 0.2, angry: 0.1 }, weight: 0.5 },
  PepeLaugh:      { scores: { hype: 0.2, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.8 },
};

// ─────────────────────────────────────────────
// 台灣 / 中文直播聊天室常用詞
// ─────────────────────────────────────────────
const twEmotes: EmoteMap = {
  // 興奮
  '好耶':   { scores: { hype: 0.8, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  '讚':     { scores: { hype: 0.6, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '神':     { scores: { hype: 0.9, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '太強了': { scores: { hype: 0.9, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '8888':   { scores: { hype: 0.7, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.65 },
  '888':    { scores: { hype: 0.65, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '777':    { scores: { hype: 0.6, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.55 },
  '666':    { scores: { hype: 0.65, funny: 0.25, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '哇':     { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '哇哇哇': { scores: { hype: 0.8, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  '超強':   { scores: { hype: 0.85, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  '讚讚':   { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.65 },

  // 搞笑
  '笑死':   { scores: { hype: 0.2, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  '草':     { scores: { hype: 0.1, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  'www':    { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  '哈哈哈': { scores: { hype: 0.2, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '哈哈':   { scores: { hype: 0.1, funny: 0.75, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  '笑':     { scores: { hype: 0.1, funny: 0.7, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '哈':     { scores: { hype: 0.1, funny: 0.6, sad: 0.0, angry: 0.0 }, weight: 0.5 },
  '傻了':   { scores: { hype: 0.2, funny: 0.7, sad: 0.0, angry: 0.0 }, weight: 0.65 },
  '根本':   { scores: { hype: 0.2, funny: 0.5, sad: 0.0, angry: 0.1 }, weight: 0.4 },

  // 悲傷
  'QQ':     { scores: { hype: 0.0, funny: 0.1, sad: 0.85, angry: 0.0 }, weight: 0.8 },
  '嗚嗚':   { scores: { hype: 0.0, funny: 0.1, sad: 0.8, angry: 0.0 }, weight: 0.75 },
  '可憐':   { scores: { hype: 0.0, funny: 0.1, sad: 0.75, angry: 0.1 }, weight: 0.65 },
  '痛':     { scores: { hype: 0.0, funny: 0.1, sad: 0.6, angry: 0.3 }, weight: 0.6 },
  '難過':   { scores: { hype: 0.0, funny: 0.0, sad: 0.9, angry: 0.0 }, weight: 0.75 },
  '悲':     { scores: { hype: 0.0, funny: 0.1, sad: 0.8, angry: 0.0 }, weight: 0.65 },
  '哭了':   { scores: { hype: 0.0, funny: 0.15, sad: 0.85, angry: 0.0 }, weight: 0.8 },
  '嗚':     { scores: { hype: 0.0, funny: 0.1, sad: 0.7, angry: 0.0 }, weight: 0.6 },

  // 憤怒 / 不滿
  '幹':     { scores: { hype: 0.2, funny: 0.3, sad: 0.0, angry: 0.7 }, weight: 0.75 },
  '幹幹幹': { scores: { hype: 0.1, funny: 0.2, sad: 0.0, angry: 0.9 }, weight: 0.85 },
  '暴怒':   { scores: { hype: 0.0, funny: 0.1, sad: 0.0, angry: 0.9 }, weight: 0.85 },
  '什麼鬼': { scores: { hype: 0.1, funny: 0.3, sad: 0.0, angry: 0.6 }, weight: 0.65 },
  '爛':     { scores: { hype: 0.0, funny: 0.2, sad: 0.1, angry: 0.7 }, weight: 0.65 },
  '幹嘛':   { scores: { hype: 0.0, funny: 0.2, sad: 0.0, angry: 0.5 }, weight: 0.5 },
  '氣死':   { scores: { hype: 0.0, funny: 0.2, sad: 0.0, angry: 0.85 }, weight: 0.8 },
};

// ─────────────────────────────────────────────
// 日文直播聊天室常用詞
// ─────────────────────────────────────────────
const jpEmotes: EmoteMap = {
  // 興奮
  'すごい':   { scores: { hype: 0.85, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  'すごすぎ': { scores: { hype: 0.9, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '神':       { scores: { hype: 0.9, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.8 }, // ※與中文同字
  'やば':     { scores: { hype: 0.75, funny: 0.3, sad: 0.1, angry: 0.0 }, weight: 0.7 },
  'やばい':   { scores: { hype: 0.75, funny: 0.3, sad: 0.1, angry: 0.0 }, weight: 0.7 },
  'マジか':   { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.65 },
  'gg':       { scores: { hype: 0.6, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.55 },
  'GG':       { scores: { hype: 0.6, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.55 },
  'うぽつ':   { scores: { hype: 0.5, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.4 },  // 投稿お疲れ様
  'わこつ':   { scores: { hype: 0.5, funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.4 },  // 枠お疲れ様
  '888':      { scores: { hype: 0.7, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },  // 拍手

  // 搞笑
  '草':     { scores: { hype: 0.1, funny: 0.9, sad: 0.0, angry: 0.0 }, weight: 0.85 }, // ※與中文同字
  'ワロタ': { scores: { hype: 0.1, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  'kusa':   { scores: { hype: 0.1, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  'www':    { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.0 }, weight: 0.75 }, // ※與中文同字
  'wwww':   { scores: { hype: 0.1, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  'ｗｗｗ': { scores: { hype: 0.1, funny: 0.8, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  'ｗ':     { scores: { hype: 0.05, funny: 0.6, sad: 0.0, angry: 0.0 }, weight: 0.5 },
  'w':      { scores: { hype: 0.05, funny: 0.6, sad: 0.0, angry: 0.0 }, weight: 0.45 },
  '笑':     { scores: { hype: 0.1, funny: 0.7, sad: 0.0, angry: 0.0 }, weight: 0.6 },

  // 悲傷
  '泣':       { scores: { hype: 0.0, funny: 0.1, sad: 0.85, angry: 0.0 }, weight: 0.8 },
  '泣いた':   { scores: { hype: 0.0, funny: 0.0, sad: 0.9, angry: 0.0 }, weight: 0.85 },
  'かわいそう':{ scores: { hype: 0.0, funny: 0.0, sad: 0.8, angry: 0.0 }, weight: 0.7 },

  // 憤怒
  '怒':       { scores: { hype: 0.1, funny: 0.1, sad: 0.0, angry: 0.85 }, weight: 0.8 },
  'は？':     { scores: { hype: 0.0, funny: 0.2, sad: 0.0, angry: 0.7 }, weight: 0.65 },
  'なんで':   { scores: { hype: 0.0, funny: 0.2, sad: 0.1, angry: 0.5 }, weight: 0.5 },
};

// ─────────────────────────────────────────────
// Unicode Emoji
// ─────────────────────────────────────────────
const unicodeEmoji: EmoteMap = {
  // 搞笑
  '😂': { scores: { hype: 0.2, funny: 0.95, sad: 0.0, angry: 0.0 }, weight: 0.9 },
  '🤣': { scores: { hype: 0.2, funny: 1.0,  sad: 0.0, angry: 0.0 }, weight: 0.95 },
  '😆': { scores: { hype: 0.3, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '😹': { scores: { hype: 0.2, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '💀': { scores: { hype: 0.1, funny: 0.9,  sad: 0.0, angry: 0.0 }, weight: 0.85 }, // 笑到死

  // 興奮
  '🔥': { scores: { hype: 0.95, funny: 0.1, sad: 0.0, angry: 0.1 }, weight: 0.9 },
  '🎉': { scores: { hype: 0.9,  funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.85 },
  '👏': { scores: { hype: 0.75, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  '❤️': { scores: { hype: 0.65, funny: 0.1, sad: 0.1, angry: 0.0 }, weight: 0.65 },
  '💪': { scores: { hype: 0.8,  funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  '🚀': { scores: { hype: 0.85, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.75 },
  '⭐': { scores: { hype: 0.7,  funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '✨': { scores: { hype: 0.65, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.6 },
  '🎊': { scores: { hype: 0.85, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.8 },
  '🙌': { scores: { hype: 0.8,  funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.7 },
  '👍': { scores: { hype: 0.6,  funny: 0.1, sad: 0.0, angry: 0.0 }, weight: 0.55 },
  '💯': { scores: { hype: 0.8,  funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.75 },

  // 悲傷
  '😭': { scores: { hype: 0.0, funny: 0.1,  sad: 0.9, angry: 0.0 }, weight: 0.85 },
  '😢': { scores: { hype: 0.0, funny: 0.0,  sad: 0.85, angry: 0.0 }, weight: 0.8 },
  '🥺': { scores: { hype: 0.0, funny: 0.15, sad: 0.8, angry: 0.0 }, weight: 0.75 },
  '💔': { scores: { hype: 0.0, funny: 0.0,  sad: 0.9, angry: 0.1 }, weight: 0.8 },
  '😔': { scores: { hype: 0.0, funny: 0.0,  sad: 0.75, angry: 0.0 }, weight: 0.65 },
  '😞': { scores: { hype: 0.0, funny: 0.0,  sad: 0.8, angry: 0.1 }, weight: 0.7 },

  // 憤怒
  '😡': { scores: { hype: 0.1, funny: 0.0, sad: 0.0, angry: 0.95 }, weight: 0.9 },
  '🤬': { scores: { hype: 0.1, funny: 0.0, sad: 0.0, angry: 1.0  }, weight: 0.95 },
  '😤': { scores: { hype: 0.2, funny: 0.1, sad: 0.0, angry: 0.8  }, weight: 0.75 },
  '💢': { scores: { hype: 0.1, funny: 0.1, sad: 0.0, angry: 0.85 }, weight: 0.8 },
  '😠': { scores: { hype: 0.1, funny: 0.0, sad: 0.0, angry: 0.85 }, weight: 0.75 },

  // 驚嚇 / 緊張
  '😱': { scores: { hype: 0.5, funny: 0.2, sad: 0.1, angry: 0.0 }, weight: 0.75 },
  '😨': { scores: { hype: 0.3, funny: 0.1, sad: 0.2, angry: 0.0 }, weight: 0.65 },
  '😰': { scores: { hype: 0.2, funny: 0.1, sad: 0.3, angry: 0.0 }, weight: 0.6 },
  '🤯': { scores: { hype: 0.7, funny: 0.3, sad: 0.0, angry: 0.0 }, weight: 0.75 },

  // 無聊 / 中性
  '😴': { scores: { hype: 0.0, funny: 0.2, sad: 0.1, angry: 0.0 }, weight: 0.4 },
  '🙄': { scores: { hype: 0.0, funny: 0.3, sad: 0.0, angry: 0.3 }, weight: 0.5 },
  '🤔': { scores: { hype: 0.1, funny: 0.2, sad: 0.0, angry: 0.0 }, weight: 0.35 },
};

// ─────────────────────────────────────────────
// 合併所有映射表並匯出
// ─────────────────────────────────────────────
export const EMOTE_MAP: EmoteMap = {
  ...twitchEmotes,
  ...twEmotes,
  ...jpEmotes,
  ...unicodeEmoji,
};

/**
 * 文字關鍵詞映射（用於正則匹配，補充 emote-map 未收錄的詞彙）
 * 以正則字串為 key，方便 RulesAnalyzer 轉換成 RegExp
 */
export const KEYWORD_MAP: Array<{ pattern: RegExp; entry: EmoteEntry }> = [
  // 笑相關
  { pattern: /哈{3,}/,    entry: { scores: { hype: 0.2, funny: 0.85, sad: 0.0, angry: 0.0 }, weight: 0.8 } },
  { pattern: /w{3,}/i,    entry: { scores: { hype: 0.1, funny: 0.8,  sad: 0.0, angry: 0.0 }, weight: 0.75 } },
  { pattern: /草{2,}/,    entry: { scores: { hype: 0.1, funny: 0.9,  sad: 0.0, angry: 0.0 }, weight: 0.85 } },
  // 8 連打（台灣掌聲）
  { pattern: /8{3,}/,     entry: { scores: { hype: 0.7, funny: 0.2,  sad: 0.0, angry: 0.0 }, weight: 0.65 } },
  // 哭哭
  { pattern: /嗚{2,}/,    entry: { scores: { hype: 0.0, funny: 0.1,  sad: 0.8, angry: 0.0 }, weight: 0.7 } },
  // 幹爆
  { pattern: /幹{2,}/,    entry: { scores: { hype: 0.1, funny: 0.2,  sad: 0.0, angry: 0.9 }, weight: 0.85 } },
  // 日文 w 連打
  { pattern: /ｗ{2,}/,    entry: { scores: { hype: 0.1, funny: 0.8,  sad: 0.0, angry: 0.0 }, weight: 0.75 } },
  // 感嘆號連打通常是興奮
  { pattern: /！{3,}/,    entry: { scores: { hype: 0.7, funny: 0.2,  sad: 0.0, angry: 0.1 }, weight: 0.5 } },
  { pattern: /!{3,}/,     entry: { scores: { hype: 0.7, funny: 0.2,  sad: 0.0, angry: 0.1 }, weight: 0.5 } },
  // 問號連打通常是困惑/憤怒
  { pattern: /[?？]{3,}/, entry: { scores: { hype: 0.0, funny: 0.2,  sad: 0.0, angry: 0.5 }, weight: 0.5 } },
];
