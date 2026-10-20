import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT || '8788';
const dbPath = process.env.DATABASE_URL || 'data/test-e2e.db';
export const e2eImagesDir = process.env.IMAGES_DIR || path.join(os.tmpdir(), 'cyberpgm-e2e-images');

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
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
    command: `PORT=${port} DATABASE_URL=${dbPath} IMAGES_DIR=${e2eImagesDir} tsx apps/server/src/index.ts`,
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
