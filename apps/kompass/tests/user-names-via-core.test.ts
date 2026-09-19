import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '../src/app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Namen von Nutzern holen Seiten über den Kern (`userNamesFor`,
 * `activeUserChoices`), nicht selbst aus `schema.users`. Die DMS-Detailseite
 * las nur aktive Nutzer und zeigte deshalb bei Notizen deaktivierter Autoren
 * die rohe ID (gefunden 2026-09-19).
 */
describe('Nutzernamen über den Kern', () => {
  it('keine Seite liest schema.users selbst', () => {
    const offenders = sources(APP)
      .filter((file) => readFileSync(file, 'utf8').includes('schema.users'))
      .map((file) => path.relative(APP, file));
    expect(offenders).toEqual([]);
  });
});
