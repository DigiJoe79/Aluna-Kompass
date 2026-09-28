import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startServer, warmUp, workerEnvironment, type RunningServer, type ServerKind } from './servers';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * `page.goto` wartet, bis React die Seite übernommen hat.
 *
 * Playwrights `goto` kehrt bei `load` zurück — das Skript ist dann geladen,
 * nicht gelaufen. Bis React seine Handler angehängt hat, steht die Seite
 * vollständig da und tut nichts: Ein `fill` schreibt in ein Feld, das niemand
 * ausliest, ein `press` geht an ein Fenster, das noch nicht zuhört. Auf einem
 * schnellen Rechner ist das Fenster null Millisekunden breit, auf dem
 * CI-Läufer war es breit genug für vier rote Läufe (`help.spec.ts`,
 * `media.spec.ts`, dreimal der Betreff im DMS-Empfangsdialog).
 *
 * Deshalb steht das Warten hier und nicht in den Tests: Nachgerüstet wurde es
 * bisher immer dort, wo es gerade zugeschlagen hatte — vier Reparaturen, und
 * der Mechanismus suchte sich den nächsten Fall. `e2e/hydration.spec.ts` löst
 * ihn absichtlich aus und hält diese Fixture ehrlich.
 *
 * Für das Warten mitten auf einer Seite — ein Dialog, ein nachgeladener
 * Bereich — bleibt `waitForHydration()` aus `helpers.ts`.
 */
async function waitForReact(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.hydrated === 'true' ||
        // Nicht jede Adresse führt in die Anwendung: `/site/preview` liefert die
        // gebaute Website aus einem Route Handler, ganz ohne React. Dort gäbe es
        // nie einen Marker, und die Fixture wartete fünf Sekunden ins Leere.
        // Erst wenn das Dokument steht, ist das Fehlen der Next-Skripte ein
        // Beleg und kein Zwischenstand.
        (document.readyState === 'complete' && !document.querySelector('script[src*="/_next/"]')),
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    // Nicht den Test hier abbrechen: Die Zusicherung, die gleich folgt, sagt
    // deutlicher, was fehlt, als ein Fehler aus einer Fixture. Die Zeile im
    // Protokoll verhindert, dass es stillschweigend passiert.
    console.warn(`[fixture] keine Hydration auf ${page.url()} innerhalb von 5s`);
  }
}

/**
 * Ein Server je Worker (siehe `servers.ts`). `parallelIndex` statt
 * `workerIndex`: Nach einem Fehlschlag ersetzt Playwright den Worker durch
 * einen neuen mit höherem `workerIndex`, aber derselbe Platz — und damit
 * derselbe Port — wird wieder frei, weil der alte Worker seinen Server beim
 * Abbau stoppt.
 */
export const test = base.extend<Record<never, never>, { serverKind: ServerKind; server: RunningServer }>({
  serverKind: ['dev', { scope: 'worker', option: true }],
  server: [
    async ({ serverKind }, use, workerInfo) => {
      const w = workerEnvironment(serverKind, workerInfo.parallelIndex, ROOT);
      // `site-publish.spec.ts` schaut auf dem Wirt nach, was publiziert wurde;
      // `dms.spec.ts` tauscht eine Datei im Datenpfad aus (nur im Dev-Ring).
      process.env.E2E_SITE_TARGET = w.siteTarget;
      if (w.env.DATA_PATH) process.env.E2E_DATA_PATH = w.env.DATA_PATH;
      else delete process.env.E2E_DATA_PATH;
      const server = await startServer(w, { root: ROOT, image: process.env.E2E_IMAGE });
      await warmUp(server.url, path.join(ROOT, 'src', 'app'));
      await use(server);
      await server.stop();
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (...args: Parameters<Page['goto']>) => {
      const response = await goto(...args);
      await waitForReact(page);
      return response;
    };
    await use(page);
  },
});

export { expect };
