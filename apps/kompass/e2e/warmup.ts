import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Einmal jede Seite abrufen, bevor der erste Test läuft.
 *
 * `next dev` übersetzt jede Route beim ersten Aufruf. Passiert das **im** Test,
 * läuft die Übersetzung innerhalb der Frist einer Zusicherung mit — und
 * Playwrights Vorgabe von fünf Sekunden reicht dafür auf einem kalten Läufer
 * nicht. Lokal fiel es nie auf, weil `.next` dort zwei Gigabyte warm liegt; die
 * CI startet immer kalt. Gemessen am 11.09.: derselbe Test 1,9 s warm, 42 s
 * kalt, und zwei rote CI-Läufe an genau dieser Stelle.
 *
 * Hier bezahlt das Aufwärmen niemand mehr, der etwas prüft.
 */
const APP = path.resolve(import.meta.dirname, '../src/app');

/** Alle Seiten ohne Platzhalter — für `[id]` liesse sich keine Adresse raten. */
function staticRoutes(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  return [
    ...new Set(
      walk(APP)
        .filter((file) => path.basename(file) === 'page.tsx')
        .map((file) => path.relative(APP, path.dirname(file)))
        .filter((route) => !route.includes('['))
        // Gruppen wie `(shell)` stehen nicht in der Adresse.
        .map((route) =>
          route
            .split(path.sep)
            .filter((part) => !part.startsWith('(') && part !== '.')
            .join('/'),
        )
        .map((route) => `/${route}`),
    ),
  ].sort();
}

export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;

  // Die Reihenfolge von `webServer` und `globalSetup` ist nicht zugesichert;
  // deshalb warten statt annehmen.
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      await fetch(`${baseURL}/api/health`);
      break;
    } catch {
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const routes = staticRoutes();
  const started = Date.now();
  // Nacheinander: Ein kalter Server mit zwei Kernen wird von zwanzig
  // gleichzeitigen Übersetzungen nicht schneller.
  for (const route of routes) {
    await fetch(`${baseURL}${route}`, { redirect: 'follow' }).catch(() => {});
  }
  console.log(`[warmup] ${routes.length} Routen in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
