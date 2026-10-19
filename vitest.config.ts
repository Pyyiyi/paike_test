import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./frontend/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['frontend/**/*.test.ts', 'happy-dom']],
    include: ['backend/tests/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    setupFiles: ['frontend/src/test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
