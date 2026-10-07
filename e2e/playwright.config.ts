// Playwright configuration: boots the real server (embedded Postgres, local storage) and the
// static demo, then runs the suites against them. Two browser contexts per test stand in
// for the mentor and the student (CLAUDE.md §7).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPort = 4000;
const demoPort = 3000;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${demoPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node packages/server/dist/index.js',
      cwd: root,
      url: `http://localhost:${serverPort}/healthz`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(serverPort),
        CORS_ORIGINS: `http://localhost:${demoPort}`,
        DATABASE_URL: 'pglite://memory',
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: './.data/e2e-uploads',
        AUTH_LOCAL_ENABLED: 'true',
        AUTH_LOCAL_JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123456',
        AUTH_LOCAL_SEED_PASSWORD: 'password123',
        AUTH_HOST_SHARED_SECRET: 'e2e-host-secret-e2e-host-secret-1234567',
        LOG_LEVEL: 'warn',
        RATE_LIMIT_LOGIN_PER_MINUTE: '1000',
      },
    },
    {
      command: 'pnpm --filter @live-class/demo start',
      cwd: root,
      url: `http://localhost:${demoPort}/`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
