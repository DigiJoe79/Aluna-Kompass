import { defineConfig } from '@playwright/test';
import { workerCount, type ServerKind } from './e2e/servers';

/**
 * Kein `webServer` mehr: Jeder Worker startet seinen eigenen `next dev` auf
 * 3100 + Platz, mit eigenem Datenpfad und Build-Verzeichnis (`e2e/servers.ts`,
 * Fixture `server` in `e2e/fixtures.ts`). Der Reset-Endpunkt gehört dem
 * jeweiligen Server, deshalb stören sich die Worker nicht. `fullyParallel`
 * bleibt aus: Verteilt werden Dateien, nicht Fälle.
 */
export default defineConfig<{ serverKind: ServerKind }>({
  testDir: './e2e',
  fullyParallel: false,
  workers: workerCount(process.env),
  /**
   * Online ein Wiederholungsversuch, lokal keiner.
   *
   * Das trennt zwei Dinge, die nichts miteinander zu tun haben: ob ein Test
   * wackelt, und ob ein Push blockiert ist. Ohne diese Trennung kostete jeder
   * Wackler einen roten Lauf und eine Untersuchungsrunde — bei einer Quote von
   * jedem vierten Push am 14.09. Verdeckt wird dabei nichts: Playwright meldet
   * einen Fall, der erst im zweiten Anlauf durchkommt, als `flaky`, und der
   * Bericht führt ihn weiter auf.
   *
   * Lokal bleibt es bei null. Beim Entwickeln soll ein Wackler sofort
   * auffallen, nicht weggebügelt werden — `pnpm verify` ist die Stelle, an der
   * er ehrlich zuschlagen muss. `pnpm e2e:stress` fährt mit vielen Workern und
   * macht die Fenster breit, in denen er zuschlägt.
   */
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  // Ohne HTML-Bericht lädt die CI bei einem Fehlschlag ein leeres Artefakt
  // hoch („No files were found“) — und man sitzt vor einem roten Lauf ohne
  // Bild. Die Spur gibt es nur beim Fehlschlag, damit der grüne Lauf schnell
  // bleibt.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { serverKind: 'dev', locale: 'de-DE', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
});
