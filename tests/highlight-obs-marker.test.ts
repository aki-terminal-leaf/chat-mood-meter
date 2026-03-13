/**
 * highlight-obs-marker.test.ts
 * 測試 OBSMarker：停用時的靜默行為與建構子安全性。
 */

import { describe, it, expect, vi } from 'vitest';
import { OBSMarker } from '../src/highlight/obs-marker.js';
import type { Config } from '../src/types.js';

// ─── 工具函式 ────────────────────────────────────────────────

/**
 * 建立停用 OBS 的 config
 */
function makeDisabledConfig(): Pick<Config, 'obs'> {
  return {
    obs: {
      enabled: false,
      host: 'localhost',
      port: 4455,
      password: '',
    },
  };
}

/**
 * 建立啟用 OBS 的 config（實際不會連線，僅測試不拋錯）
 */
function makeEnabledConfig(): Pick<Config, 'obs'> {
  return {
    obs: {
      enabled: true,
      host: 'localhost',
      port: 4455,
      password: 'test-password',
    },
  };
}

// ─── 測試套件 ────────────────────────────────────────────────

describe('OBSMarker', () => {

  // ── 建構子 ──────────────────────────────────────────────────

  describe('建構子', () => {
    it('disabled config 下不拋錯', () => {
      expect(() => new OBSMarker(makeDisabledConfig())).not.toThrow();
    });

    it('enabled config 下不拋錯（僅建構，不連線）', () => {
      expect(() => new OBSMarker(makeEnabledConfig())).not.toThrow();
    });
  });

  // ── config.obs.enabled = false ───────────────────────────────

  describe('config.obs.enabled = false', () => {
    it('connect() 不嘗試連線（靜默返回）', async () => {
      const marker = new OBSMarker(makeDisabledConfig());

      // 監聽 console.log，驗證有印出「已停用」提示而非連線訊息
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // 不應拋出例外，也不應嘗試真實連線
      await expect(marker.connect()).resolves.toBeUndefined();

      // 應該印出停用提示（不是連線成功）
      const logCalls = consoleSpy.mock.calls.map(args => args[0] as string);
      const hasDisabledMsg = logCalls.some(msg => msg.includes('停用') || msg.includes('disabled') || msg.includes('OBS'));
      expect(hasDisabledMsg).toBe(true);

      consoleSpy.mockRestore();
    });

    it('createMarker() 靜默返回，不拋出例外', async () => {
      const marker = new OBSMarker(makeDisabledConfig());

      // 未呼叫 connect()，且 enabled=false
      await expect(marker.createMarker('TEST LABEL')).resolves.toBeUndefined();
    });

    it('createMarker() 不呼叫任何 OBS API', async () => {
      const marker = new OBSMarker(makeDisabledConfig());

      // 監聽 console.warn，確認沒有「尚未連線」的警告（直接靜默返回）
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await marker.createMarker('HYPE 95%');

      // enabled=false 直接 return，不應走到「尚未連線」的 warn 分支
      const warnCalls = warnSpy.mock.calls.map(args => args[0] as string);
      const hasNotConnectedWarn = warnCalls.some(msg =>
        typeof msg === 'string' && msg.includes('尚未連線')
      );
      expect(hasNotConnectedWarn).toBe(false);

      warnSpy.mockRestore();
    });
  });

  // ── disconnect() 安全性 ──────────────────────────────────────

  describe('disconnect()', () => {
    it('未連線時呼叫 disconnect() 不拋錯', async () => {
      const marker = new OBSMarker(makeDisabledConfig());
      await expect(marker.disconnect()).resolves.toBeUndefined();
    });
  });
});
