import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT || '8788';
const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `PORT=${port} DATABASE_URL=${dbPath} tsx apps/server/src/index.ts`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
