import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, relative, sourceFiles, SRC } from './patterns/source';

/**
 * Seiten und Layouts ausserhalb von `(shell)` werden nicht durch das Layout der Schale dynamisch, das Cookies liest.
 * Lesen sie die Datenbank, backt `next build` deren Zustand zur Bauzeit in HTML ein — im Container ist die Datenbank
 * dabei leer. So landete /login dauerhaft auf einer Weiterleitung zur Einrichtung. Das Wurzel-Layout liest das Theme
 * und läuft für jede Seite: Ohne `force-dynamic` öffneten siebzehn Build-Worker dieselbe SQLite-Datei zugleich
 * (`SQLITE_BUSY: database is locked`).
 *
 * Geprüft wird jede `page.tsx`/`layout.tsx` unter `src/app` ausserhalb von `(shell)`: Wer die Datenbank liest, ist
 * `force-dynamic` — oder liest selbst die Anfrage (`requireSession`, `cookies()`, `headers()`), was Next ebenso je
 * Anfrage rendern lässt.
 */
const READS_DB = /\b(?:getDeps|isSetupRequired|requireSession|readSetting)\(/;
const DYNAMIC = /export const dynamic = 'force-dynamic'|\b(?:requireSession|cookies|headers)\(/;

const pages = () =>
  sourceFiles(path.join(SRC, 'app'))
    .map(relative)
    .filter((file) => /(?:^|\/)(?:page|layout)\.tsx$/.test(file) && !file.startsWith('app/(shell)/'));

describe('Seiten ausserhalb der Schale mit Datenbank', () => {
  it('findet die Seiten vor der Anmeldung und das Wurzel-Layout (Gegenprobe gegen die bekannten)', () => {
    expect(pages()).toEqual(expect.arrayContaining(['app/layout.tsx', 'app/login/page.tsx', 'app/setup/page.tsx']));
    for (const file of ['app/layout.tsx', 'app/login/page.tsx', 'app/setup/page.tsx']) expect(read(path.join(SRC, file)), file).toMatch(READS_DB);
  });

  it('werden je Anfrage gerendert, nicht beim Bauen', () => {
    const prerendered = pages().filter((file) => {
      const source = read(path.join(SRC, file));
      return READS_DB.test(source) && !DYNAMIC.test(source);
    });
    expect(prerendered, "export const dynamic = 'force-dynamic' fehlt").toEqual([]);
  });
});
