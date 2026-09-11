import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dataPath = path.resolve(import.meta.dirname, 'e2e/.tmp/data');
const siteTarget = path.resolve(import.meta.dirname, 'e2e/.tmp/site-target');
const siteTemplateDir = path.resolve(import.meta.dirname, '../../templates/verein-basis');
process.env.E2E_SITE_TARGET = siteTarget;
process.env.E2E_SITE_TEMPLATE_DIR = siteTemplateDir;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/warmup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  // Ohne HTML-Bericht lädt die CI bei einem Fehlschlag ein leeres Artefakt
  // hoch („No files were found“) — und man sitzt vor einem roten Lauf ohne
  // Bild. Die Spur gibt es nur beim Fehlschlag, damit der grüne Lauf schnell
  // bleibt.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', locale: 'de-DE', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec next dev -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      DATA_PATH: dataPath,
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
      E2E_RESET_TOKEN: 'e2e-reset',
      SITE_PUBLIC_URL: 'https://staging.example.org',
      SITE_STAGING: '1',
      SITE_DEPLOY_HOST: '',
      SITE_DEPLOY_USER: '',
      SITE_DEPLOY_PATH: siteTarget,
      SITE_DEPLOY_KEY_FILE: '',
      SITE_TEMPLATE_DIR: siteTemplateDir,
      SITE_CACHE_DIR: path.resolve(import.meta.dirname, 'e2e/.tmp/site-cache'),
      SITE_PREVIEW_DIR: path.resolve(import.meta.dirname, 'e2e/.tmp/site-preview'),
    },
  },
});
