import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dbPath = path.resolve(import.meta.dirname, 'e2e/.tmp/kompass.db');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', locale: 'de-DE', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'pnpm exec next dev -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      DATABASE_PATH: dbPath,
      MEDIA_PATH: path.resolve(import.meta.dirname, 'e2e/.tmp/media'),
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
      E2E_RESET_TOKEN: 'e2e-reset',
    },
  },
});
