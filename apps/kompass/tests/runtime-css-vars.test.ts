import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_TOKENS } from '@kompass/core';
import { describe, expect, it } from 'vitest';

/**
 * Ein `var(--color-…)` im Code (etwa in einer Tailwind-Klasse mit eckigen Klammern) muss zur Laufzeit existieren.
 * Die Namen aus `@theme inline reference` in `globals.css` gibt es nur für Tailwind, nicht im Browser — ein solches
 * `var()` macht die ganze Angabe ungültig. So verlor der rote Knopf beim Überfahren seine Fläche, weil
 * `var(--color-ink)` leer war; zur Laufzeit heißt der Wert `--ink` (Joe 2026-10-18).
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('CSS-Variablen im Code', () => {
  it('jedes var(--color-…) ist ein Theme-Token, das zur Laufzeit gesetzt wird', () => {
    const runtime = new Set<string>(THEME_TOKENS);
    const unknown: string[] = [];
    for (const file of sourceFiles(join(__dirname, '../src'))) {
      if (file.endsWith('globals.css')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(/var\(--(color-[a-z0-9-]+)\)/g)) {
        if (!runtime.has(match[1]!)) unknown.push(`${file.replace(/.*\/src\//, 'src/')}: --${match[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
