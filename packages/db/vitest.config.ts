import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@cmm/core': resolve(__dirname, '../core/src/index.ts'),
      '@cmm/core/types': resolve(__dirname, '../core/src/types.ts'),
    },
  },
});
