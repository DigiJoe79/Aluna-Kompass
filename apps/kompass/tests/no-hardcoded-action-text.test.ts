import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Was eine Server-Action als `message` oder `fieldErrors` zurückgibt, landet
 * unverändert auf dem Bildschirm. Es gehört deshalb nach `messages/de.json` und
 * nicht in den Code (AGENTS.md, Prinzip 7) — sonst kann eine zweite Sprache es
 * nie erreichen, und der Satz steht an einer Stelle, an der ihn niemand sucht.
 *
 * Gesucht wird nach Zeichenketten-Literalen an diesen beiden Feldern. Erlaubt
 * ist alles, was aus `t(...)` kommt oder aus `toActionState`, das seinerseits
 * übersetzt.
 */
const ROOT = path.resolve(import.meta.dirname, '../src/app');
const LITERAL = /^\s*(message|fieldErrors)\b[^,]*:\s*[`'"]/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('Server-Actions schreiben keinen Oberflächentext', () => {
  it('holen jede Meldung aus der Sprachdatei', () => {
    const offenders = walk(ROOT)
      .filter((file) => path.basename(file) === 'actions.ts')
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, at: `${path.relative(ROOT, file)}:${index + 1}` }))
          .filter(({ line }) => LITERAL.test(line))
          .map(({ at, line }) => `${at}: ${line.trim()}`),
      );

    expect(offenders).toEqual([]);
  });
});
