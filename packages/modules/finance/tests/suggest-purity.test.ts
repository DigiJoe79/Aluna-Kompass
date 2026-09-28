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
        // Die eine Ausnahme (F8a Task 1): `rule.ts` reicht die reine Regelprüfung vom neutralen Boden weiter.
        .filter((spec) => !(f === 'rule.ts' && spec === '../../rules-pure'))
        .filter((spec) => spec.startsWith('@kompass/') || spec.startsWith('../') || spec === '..')
        .map((spec) => `${f}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * F8a Task 1: Die Regelprüfung liegt auf neutralem Boden, weil auch
   * `allocation/` (Kategorievorschlag der Freigabe) sie braucht und `import/`
   * nicht kennen darf (`direction.test.ts`). Sie bleibt rein — sie importiert gar nichts.
   */
  it('keeps the rule check on neutral ground, pure, and re-exported from suggest/rule.ts', () => {
    const pure = readFileSync(path.resolve(DIR, '../../rules-pure.ts'), 'utf8');
    expect([...pure.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1])).toEqual([]);
    expect(pure).toMatch(/export function ruleMatches\(/);
    expect(pure).toMatch(/export function normalizeText\(/);
    const rule = readFileSync(path.join(DIR, 'rule.ts'), 'utf8');
    expect(rule).toContain("from '../../rules-pure'");
    expect(rule).not.toMatch(/function ruleMatches/);
  });

  it('holds the five building blocks of the suggestions', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(['pair.ts', 'reference.ts', 'return.ts', 'rule.ts', 'text.ts']);
  });
});
