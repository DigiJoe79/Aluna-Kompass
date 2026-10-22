import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowlistIssues, read, staleKeys } from './source';

/**
 * Meta-Test über die Erlaubnislisten aller Wächter (Testdurchsicht 2026-10-22, Plan P1): Jede Liste ist eine
 * `Allowlist` oder `CountedAllowlist` und läuft durch `allowlistHygiene` aus `source.ts` — jeder Eintrag mit Grund,
 * keiner vorläufig (`OFFEN …`), jeder noch nötig (bei gezählten Listen die Zahl). Bis dahin schrieb jeder Wächter seine
 * eigenen „Ausnahme noch nötig“- und „kein OFFEN“-Fälle, rund 25-mal mit eigener Logik.
 *
 * Warum die Prüfung selbst im Wächter läuft und nicht hier: Ob eine Ausnahme noch nötig ist, weiß nur der Wächter mit
 * seinen Treffern, und eine Testdatei lässt sich nicht importieren, ohne ihre Tests ein zweites Mal anzumelden. Dieser
 * Test sichert deshalb, dass keine Liste an der gemeinsamen Hygiene vorbeigeht.
 */
const DIR = import.meta.dirname;
const guards = readdirSync(DIR)
  .filter((name) => name.endsWith('.test.ts') && name !== 'allowlists.test.ts')
  .map((name) => ({ name, text: read(path.join(DIR, name)) }));

/** Die Namen der Erlaubnislisten einer Datei: jede Konstante vom Typ `Allowlist` oder `CountedAllowlist`. */
export function allowlistNames(text: string): string[] {
  return [...text.matchAll(/^(?:export )?const (\w+): (?:Allowlist|CountedAllowlist) =/gm)].map((m) => m[1]!);
}

describe('Hygiene der Erlaubnislisten', () => {
  it('meldet fehlenden Grund, vorläufige und veraltete Einträge', () => {
    expect(allowlistIssues({ a: 'Grund', b: ' ', c: 'OFFEN: klären' }, ['d'])).toEqual(['b: ohne Grund', 'c: vorläufig (OFFEN)', 'd: nicht mehr nötig']);
    expect(allowlistIssues({ a: { count: 1, reason: 'OFFEN' } }, [])).toEqual(['a: vorläufig (OFFEN)']);
    expect(allowlistIssues({ a: 'OFFENE Posten heißen anders' }, [])).toEqual([]);
    expect(staleKeys({ a: 'x', b: 'y' }, ['a', 'a', 'z'])).toEqual(['b']);
  });

  it('erkennt die Listen einer Datei', () => {
    expect(allowlistNames("export const ALLOWED: CountedAllowlist = {};\nconst WIDE: Allowlist = {\n};\nconst X = 1;")).toEqual(['ALLOWED', 'WIDE']);
  });

  it('jede Erlaubnisliste eines Wächters läuft durch allowlistHygiene', () => {
    const missing = guards.flatMap(({ name, text }) =>
      allowlistNames(text)
        .filter((list) => !new RegExp(`allowlistHygiene\\(\\s*${list}\\b`).test(text))
        .map((list) => `${name}: ${list}`),
    );
    expect(missing).toEqual([]);
  });

  it('Erlaubnislisten tragen den Typ Allowlist oder CountedAllowlist', () => {
    const untyped = guards.flatMap(({ name, text }) =>
      [...text.matchAll(/^(?:export )?const (\w+): Record<string, (?:string|\{ count)/gm)].map((m) => `${name}: ${m[1]}`),
    );
    expect(untyped).toEqual([]);
  });

  it('kein Wächter schreibt die Hygiene von Hand', () => {
    const own = guards.flatMap(({ name, text }) =>
      [...text.matchAll(/\bit(?:\.each\([^)]*\))?\(\s*['"`]([^'"`]*(?:noch nötig|vorläufig|veraltet|gilt noch)[^'"`]*)/g)].map((m) => `${name}: ${m[1]}`),
    );
    expect(own).toEqual([]);
  });
});
