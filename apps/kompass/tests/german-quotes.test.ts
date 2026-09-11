import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * Deutsche Anführungszeichen werden unten geöffnet und **oben** geschlossen:
 * „so". Ein gerades `"` als Schlusszeichen ist ein Tippfehler, der bis in den
 * Bildschirm durchschlägt — in Protokolltexte, Fehlermeldungen und Kommentare.
 * Weil er sich beim Tippen nicht von selbst zeigt, prüft ihn ein Test statt
 * eines Vorsatzes.
 */
const OPEN_WITHOUT_PROPER_CLOSE = '„[^„“]*"';

const CODE = ['--include=*.ts', '--include=*.tsx', '--include=*.astro', '--include=*.json', '--include=*.css', '--include=*.md'];

const IGNORED = [
  'node_modules/',
  '/.next/',
  '/.astro/',
  'apps/kompass/data/',
  'tests/german-quotes.test.ts',
];

/**
 * Geprüft wird, was ausgeliefert wird, plus die Betriebsdoku. Nicht geprüft
 * werden `docs/superpowers/` und `docs/design/`: Das sind Protokolle
 * abgeschlossener Arbeit und ein übernommenes Handoff-Dokument — die schreibt
 * man nicht nachträglich um, nur damit ein Test grün wird.
 */
const SCOPE = ['packages', 'apps', 'templates', 'scripts', 'docs/betrieb.md'];

const search = (dir: string): string[] => {
  try {
    const out = execFileSync('grep', ['-rnE', OPEN_WITHOUT_PROPER_CLOSE, ...CODE, dir], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim() && !IGNORED.some((skip) => line.includes(skip)));
  } catch {
    return []; // grep endet mit Code 1, wenn es nichts findet
  }
};

describe('deutsche Anführungszeichen', () => {
  it('schließt jedes geöffnete Zeichen oben, nicht gerade', () => {
    expect(SCOPE.flatMap(search)).toEqual([]);
  });
});
