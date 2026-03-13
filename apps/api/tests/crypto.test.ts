import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/auth/crypto.js';

describe('crypto — AES-256-GCM 加解密', () => {
  const KEY = 'test-secret-key';
  const ANOTHER_KEY = 'different-key';

  // ── 基本功能 ────────────────────────────────────────────────────────
  describe('基本加解密', () => {
    it('加密後再解密，結果應與原始明文相同', () => {
      const plaintext = 'hello world';
      const ciphertext = encrypt(plaintext, KEY);
      expect(decrypt(ciphertext, KEY)).toBe(plaintext);
    });

    it('每次加密產生的密文都不同（隨機 IV）', () => {
      const plaintext = 'same content';
      const c1 = encrypt(plaintext, KEY);
      const c2 = encrypt(plaintext, KEY);
      expect(c1).not.toBe(c2);
    });

    it('密文格式應為 iv:tag:encrypted（三段以冒號分隔）', () => {
      const ciphertext = encrypt('test', KEY);
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
      // iv 為 12 bytes → 24 hex chars
      expect(parts[0]).toHaveLength(24);
      // tag 為 16 bytes → 32 hex chars
      expect(parts[1]).toHaveLength(32);
    });
  });

  // ── 錯誤情況 ────────────────────────────────────────────────────────
  describe('錯誤情況', () => {
    it('用不同的 key 解密，應拋出錯誤（GCM 認證失敗）', () => {
      const ciphertext = encrypt('secret data', KEY);
      expect(() => decrypt(ciphertext, ANOTHER_KEY)).toThrow();
    });

    it('傳入格式錯誤的密文，應拋出錯誤', () => {
      expect(() => decrypt('not-valid-ciphertext', KEY)).toThrow();
    });

    it('密文被竄改，應拋出錯誤', () => {
      const ciphertext = encrypt('original', KEY);
      const tampered = ciphertext.slice(0, -4) + 'ffff';
      expect(() => decrypt(tampered, KEY)).toThrow();
    });
  });

  // ── 邊界條件 ────────────────────────────────────────────────────────
  describe('邊界條件', () => {
    it('空字串可以正確加解密', () => {
      const ciphertext = encrypt('', KEY);
      expect(decrypt(ciphertext, KEY)).toBe('');
    });

    it('長字串（1000 字元）可以正確加解密', () => {
      const long = 'A'.repeat(1000);
      const ciphertext = encrypt(long, KEY);
      expect(decrypt(ciphertext, KEY)).toBe(long);
    });

    it('特殊字元（Unicode、Emoji、換行）可以正確加解密', () => {
      const special = '正體中文 🍂 \n\t <script>alert("xss")</script> こんにちは';
      const ciphertext = encrypt(special, KEY);
      expect(decrypt(ciphertext, KEY)).toBe(special);
    });

    it('key 超過 32 字元時，截斷後仍可正常運作', () => {
      const longKey = 'a'.repeat(64);
      const ciphertext = encrypt('test', longKey);
      expect(decrypt(ciphertext, longKey)).toBe('test');
    });

    it('key 少於 32 字元時，補齊後仍可正常運作', () => {
      const shortKey = 'x';
      const ciphertext = encrypt('test', shortKey);
      expect(decrypt(ciphertext, shortKey)).toBe('test');
    });

    it('實際的 OAuth token 格式可以正確加解密', () => {
      const oauthToken = 'ya29.A0ARrdaM-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOP';
      const ciphertext = encrypt(oauthToken, KEY);
      expect(decrypt(ciphertext, KEY)).toBe(oauthToken);
    });
  });
});
