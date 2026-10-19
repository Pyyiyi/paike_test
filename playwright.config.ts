import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5473',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --config vite.config.ts --port 5473 --strictPort',
    url: 'http://127.0.0.1:5473',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
