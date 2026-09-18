import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '../src/app');

/**
 * Seiten ausserhalb von (shell) werden nicht durch ein Layout dynamisch, das
 * Cookies liest. Lesen sie die Datenbank, backt `next build` deren Zustand zur
 * Bauzeit in HTML ein — im Container ist die Datenbank dabei leer. So landete
 * /login dauerhaft auf einer Weiterleitung zur Einrichtung.
 */
describe('pre-auth pages', () => {
  for (const route of ['login', 'setup']) {
    it(`${route} is rendered per request, not prerendered`, () => {
      const source = readFileSync(path.join(APP, route, 'page.tsx'), 'utf8');
      expect(source, `${route}/page.tsx liest die Datenbank`).toMatch(/getDeps\(|isSetupRequired\(/);
      expect(source, `${route}/page.tsx muss dynamisch sein`).toMatch(
        /export const dynamic = 'force-dynamic'/,
      );
    });
  }

});

/**
 * Das Wurzel-Layout liest das Theme aus der Datenbank und läuft damit für jede
 * Seite. Ohne `force-dynamic` rendert `next build` alles vor, was nicht selbst
 * dynamisch ist — und siebzehn Worker öffnen dieselbe SQLite-Datei zugleich.
 * Ergebnis: `SQLITE_BUSY: database is locked`, mitten im Build.
 */
describe('root layout', () => {
  it('is rendered per request, because it reads the database', () => {
    const source = readFileSync(path.join(APP, 'layout.tsx'), 'utf8');
    expect(source, 'layout.tsx liest die Datenbank').toMatch(/getDeps\(/);
    expect(source, 'layout.tsx muss dynamisch sein').toMatch(/export const dynamic = 'force-dynamic'/);
  });
});
