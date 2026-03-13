import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@cmm/core': new URL('../../packages/core/src', import.meta.url).pathname,
      '@cmm/core/types': new URL('../../packages/core/src/types.ts', import.meta.url).pathname,
      '@cmm/db': new URL('../../packages/db/src', import.meta.url).pathname,
    },
  },
});
