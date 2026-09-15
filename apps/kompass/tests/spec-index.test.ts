import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * `AGENTS.md` nennt im Abschnitt „Quellen“ die Design-Specs. Die Liste war am
 * 2026-09-15 auf zehn von achtzehn stehengeblieben — nicht falsch, aber
 * unvollständig, und das ist bei einer Liste dasselbe: Wer sie liest, hält sie
 * für die Aufzählung und sucht die übrigen acht nicht.
 *
 * Eine Liste, die von Hand gepflegt wird, veraltet. Dieser Wächter hält sie
 * an der Wirklichkeit, ohne vorzuschreiben, wie sie aufgebaut ist.
 */
describe('the spec index in AGENTS.md', () => {
  it('names every spec that exists', () => {
    const specs = readdirSync(path.join(ROOT, 'docs/superpowers/specs')).filter((f) => f.endsWith('.md'));
    const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    expect(specs.filter((spec) => !agents.includes(spec))).toEqual([]);
  });

  /** Und nennt keine, die es nicht mehr gibt. */
  it('names no spec that is gone', () => {
    const specs = new Set(readdirSync(path.join(ROOT, 'docs/superpowers/specs')));
    const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    const genannt = [...agents.matchAll(/`(\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md)`/g)].map((m) => m[1]!);
    expect(genannt.filter((name) => !specs.has(name))).toEqual([]);
  });
});
