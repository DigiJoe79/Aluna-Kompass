import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../src/import/csv');

/**
 * Der CSV-Kern läuft auch im Browser (Assistent). Er darf deshalb weder den
 * Kern noch andere Module noch Dateien außerhalb von `csv/` laden — sonst
 * zieht Turbopack `@kompass/core` in den Client (Lehre aus VP1).
 */
describe('CSV core purity', () => {
  it('imports only zod and siblings', () => {
    expect(existsSync(DIR)).toBe(true);
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) =>
      [...readFileSync(path.join(DIR, f), 'utf8').matchAll(/from '([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((spec) => spec !== 'zod' && !spec.startsWith('./'))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
