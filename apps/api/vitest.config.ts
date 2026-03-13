import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// 從 monorepo 根目錄載入 .env
config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@cmm/core': new URL('../../packages/core/src', import.meta.url).pathname,
      '@cmm/core/types': new URL('../../packages/core/src/types.ts', import.meta.url).pathname,
      '@cmm/db/schema': new URL('../../packages/db/src/schema.ts', import.meta.url).pathname,
      '@cmm/db': new URL('../../packages/db/src', import.meta.url).pathname,
      '@cmm/export': new URL('../../packages/export/src', import.meta.url).pathname,
    },
  },
});
