import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Eine Fehlergrenze fehlt nicht auffällig — sie fehlt still, bis etwas kaputt
 * geht. Dann zeigt Next seine eigene Seite: englisch, ohne Vereinsbezug, ohne
 * Weg zurück. Für die Anwendung hinter der Anmeldung gab es eine; für
 * Anmeldung, Passwortwechsel und Ersteinrichtung nicht — also ausgerechnet für
 * die Bildschirme, die ein neuer Verein zuerst sieht.
 */
const APP = path.resolve(import.meta.dirname, '../src/app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Die nächste `error.tsx` oberhalb einer Seite — Fehlergrenzen wirken nach unten. */
function hasBoundaryAbove(file: string): boolean {
  let dir = path.dirname(file);
  for (;;) {
    if (existsSync(path.join(dir, 'error.tsx'))) return true;
    if (dir === APP) return false;
    dir = path.dirname(dir);
  }
}

describe('Fehlergrenzen', () => {
  it('decken jede Seite ab', () => {
    const unguarded = walk(APP)
      .filter((file) => path.basename(file) === 'page.tsx')
      .filter((file) => !hasBoundaryAbove(file))
      .map((file) => path.relative(APP, path.dirname(file)));

    expect(unguarded).toEqual([]);
  });

  it('fangen auch einen Fehler im Rahmen selbst ab', () => {
    // `global-error.tsx` ersetzt das Wurzel-Layout und muss deshalb sein
    // eigenes Grundgerüst mitbringen.
    const file = path.join(APP, 'global-error.tsx');
    expect(existsSync(file)).toBe(true);

    const source = readFileSync(file, 'utf8');
    expect(source).toContain('<html');
    expect(source).toContain('<body');
  });
});
