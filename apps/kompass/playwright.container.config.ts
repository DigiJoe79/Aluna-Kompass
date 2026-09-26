import { defineConfig } from '@playwright/test';
import { workerCount, type ServerKind } from './e2e/servers';

/**
 * Dieselbe Suite wie `playwright.config.ts`, nur gegen das gebaute Image
 * statt gegen `next dev`.
 *
 * Der Unterschied ist nicht die Oberfläche, sondern die Verpackung: gebündelter
 * Code, ein `/data`-Volume, das mitgelieferte Basis-Template und die
 * Modulauflösung, die der Entrypoint anlegt. Genau dort lagen drei der vier
 * Fehlschläge vom 7. September, und keiner davon konnte im Entwicklungsmodus
 * auffallen.
 *
 * Voraussetzung: ein gebautes `kompass-local` (`pnpm image`); ein anderes Bild
 * über `E2E_IMAGE`. Je Worker läuft ein Container `kompass-e2e-<Platz>` auf
 * 3200 + Platz (`e2e/servers.ts`).
 */
export default defineConfig<{ serverKind: ServerKind }>({
  testDir: './e2e',
  /**
   * Der Dateispeicher liegt im Container; gemountet ist nur `/deploy`. Ein
   * Test, der eine Datei im Volume austauscht, um die Prüfsummenkontrolle zu
   * zeigen, kann das von hier aus nicht — er läuft im Dev-Ring und prüft
   * Anwendungsverhalten, nichts Containerspezifisches.
   */
  grepInvert: /ausgetauschtes Dokument/,
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: workerCount(process.env),
  // Online ein Wiederholungsversuch, lokal keiner — Begründung in `playwright.config.ts`.
  retries: process.env.CI ? 1 : 0,
  // Im Container läuft der Astro-Build gegen ein Volume und ohne warmen
  // Dev-Cache; 30 Sekunden wie im Entwicklungsmodus reichen dafür nicht.
  timeout: 240_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-container' }]],
  outputDir: 'test-results-container',
  use: { serverKind: 'container', locale: 'de-DE', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
});
