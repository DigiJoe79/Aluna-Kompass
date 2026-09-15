import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Kompass soll ein Produkt sein, das man einem anderen Verein geben kann.
 * Bis zum Cutover steckte Alunas Welt im ausgelieferten Code. Geprüft wird,
 * was ausgeliefert wird: der Quellcode und das Handbuch, das im Image liegt.
 * Nicht geprüft werden der übrige Teil von `docs/` (dort steht die
 * Entstehungsgeschichte) und `scripts/` (Entwicklungswerkzeuge, die nicht ins
 * Image gehen).
 *
 * „Aluna“ allein steht nicht auf der Liste: So heisst das Produkt selbst
 * (`Aluna Kompass`). Verboten ist, was den Verein meint.
 */
// `betterplace` kam am 2026-09-12 dazu, als die Projekte ihre Plattformspalte verloren.
//
// Die Wortgrenze davor ist nicht Zierde: Ohne sie steckt „tierhilfe“ in
// „Einsortierhilfe“, und die Prüfung des Handbuchs (2026-09-15) meldete
// prompt eine Zeile der Akte. In „aluna-tierhilfe.org“ steht der Bindestrich
// davor und ist selbst eine Grenze — der echte Fall wird weiterhin gefunden.
const FORBIDDEN = ['\\btierhilfe', '\\bzuhause-gesucht', '\\bhundeblicke\\.net', '\\bbetterplace'];

const CODE = ['--include=*.ts', '--include=*.tsx', '--include=*.astro', '--include=*.json', '--include=*.css'];

/** `apps/kompass/data` ist das Entwicklungsvolume — dort liegt das eingelesene Template des Betreibers. */
// `prototype-fixture.ts` bildet die Datenform des alten Prototyps nach, samt dessen Plattformfeld.
// Migrationen und ihre Snapshots sind Geschichte und werden nie editiert; sie tragen, was einmal war.
const IGNORED = ['node_modules/', '/.next/', '/.astro/', 'apps/kompass/data/', 'tests/no-association-content.test.ts', 'tests/prototype-fixture.ts', 'src/db/migrations/'];

const search = (dir: string, includes: string[] = CODE): string[] => {
  try {
    const out = execFileSync('grep', ['-rniE', FORBIDDEN.join('|'), ...includes, dir], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim() && !IGNORED.some((skip) => line.includes(skip)));
  } catch {
    return []; // grep endet mit Code 1, wenn es nichts findet
  }
};

describe('the product carries no association of its own', () => {
  it('names no association in packages, apps or the shipped template', () => {
    expect([...search('packages'), ...search('apps'), ...search('templates')]).toEqual([]);
  });

  /**
   * `docs/handbuch` ist kein Arbeitsdokument, sondern Produktinhalt: Der
   * Dockerfile kopiert es ins Image (`KOMPASS_HANDBOOK_DIR`), und jede
   * Installation zeigt es hinter dem „?“ in der Kopfzeile. Was hier steht,
   * liest ein fremder Verein als seine eigene Anleitung. Der übrige Teil von
   * `docs/` bleibt ausgenommen — dort steht die Entstehungsgeschichte, und
   * die darf Aluna beim Namen nennen.
   */
  it('names no association in the handbook, which ships inside the image', () => {
    expect(search('docs/handbuch', ['--include=*.md'])).toEqual([]);
  });

  /**
   * Beweist, dass die Suche greift: Ohne diesen Fall wäre der grüne Test oben
   * auch dann grün, wenn `grep` an der falschen Stelle sucht.
   */
  it('still finds the words where they legitimately stand', () => {
    expect(search('docs', ['--include=*.md']).length).toBeGreaterThan(0);
  });
});
