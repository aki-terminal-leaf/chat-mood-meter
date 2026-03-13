/**
 * AES-256-GCM 加解密，用於安全儲存 OAuth access/refresh tokens
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * 將任意長度的 key 字串轉換為固定 32 bytes 的 Buffer
 * 採用 padEnd + slice 的簡單方式（生產環境建議改用 PBKDF2/scrypt）
 */
function normalizeKey(key: string): Buffer {
  return Buffer.from(key.padEnd(32, '0').slice(0, 32));
}

/**
 * 加密明文字串
 * @returns 格式 `iv:tag:encrypted`（全 hex 編碼），以冒號分隔
 */
export function encrypt(plaintext: string, key: string): string {
  const keyBuffer = normalizeKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // 格式: iv:tag:encrypted (hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * 解密由 encrypt() 產生的密文
 * @throws 若 key 錯誤或資料被竄改，會拋出錯誤（GCM 認證失敗）
 */
export function decrypt(ciphertext: string, key: string): string {
  const keyBuffer = normalizeKey(key);
  const [ivHex, tagHex, encHex] = ciphertext.split(':');

  if (ivHex === undefined || tagHex === undefined || encHex === undefined) {
    throw new Error('無效的密文格式');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
