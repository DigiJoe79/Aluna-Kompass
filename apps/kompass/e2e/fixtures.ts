import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

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

export const test = base.extend({
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
