import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../src/import/suggest');

/**
 * Die Vorschlagsfunktionen (F5) sind rein: Sie rechnen nur mit dem, was man
 * ihnen gibt. Sie importieren deshalb nichts aus `@kompass/*` und nichts von
 * außerhalb von `suggest/` — so laufen sie im Dienst, in Tests ohne Datenbank
 * und, wenn nötig, im Browser (Muster `csv-purity.test.ts`).
 */
describe('suggestion functions purity', () => {
  it('imports nothing from @kompass/* and nothing from outside suggest/', () => {
    expect(existsSync(DIR)).toBe(true);
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) =>
      [...readFileSync(path.join(DIR, f), 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((spec) => spec.startsWith('@kompass/') || spec.startsWith('../') || spec === '..')
        .map((spec) => `${f}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('holds the five building blocks of the suggestions', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(['pair.ts', 'reference.ts', 'return.ts', 'rule.ts', 'text.ts']);
  });
});
