import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      // 讓 @cmm/core 直接解析到 packages/core/src，不需要先 build
      '@cmm/core': resolve(__dirname, '../core/src/index.ts'),
      '@cmm/core/types': resolve(__dirname, '../core/src/types.ts'),
    },
  },
});
