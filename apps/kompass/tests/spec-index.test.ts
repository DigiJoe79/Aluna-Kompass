import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SPECS = path.join(ROOT, 'docs/intern/specs');
const INDEX = path.join(ROOT, 'docs/intern/README.md');

/**
 * `docs/intern/README.md` nennt die Design-Specs mit einer Zeile je Datei. Die
 * Liste stand vorher in `AGENTS.md` und war am 2026-09-15 auf zehn von achtzehn
 * stehengeblieben — nicht falsch, aber unvollständig, und das ist bei einer
 * Liste dasselbe: Wer sie liest, hält sie für die Aufzählung und sucht die
 * übrigen acht nicht.
 *
 * Seit dem 2026-09-16 liegen die Specs in `docs/intern/`, einem eigenen
 * privaten Git, das im öffentlichen Repo ignoriert ist. Ein öffentlicher
 * Checkout hat das Verzeichnis nicht; dort gibt es nichts zu prüfen, und der
 * Wächter meldet sich als übersprungen statt still grün.
 */
describe.runIf(existsSync(SPECS))('the spec index in docs/intern/README.md', () => {
  it('names every spec that exists', () => {
    const specs = readdirSync(SPECS).filter((f) => f.endsWith('.md'));
    const index = readFileSync(INDEX, 'utf8');
    expect(specs.filter((spec) => !index.includes(spec))).toEqual([]);
  });

  /** Und nennt keine, die es nicht mehr gibt. */
  it('names no spec that is gone', () => {
    const specs = new Set(readdirSync(SPECS));
    const index = readFileSync(INDEX, 'utf8');
    const genannt = [...index.matchAll(/`(\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md)`/g)].map((m) => m[1]!);
    expect(genannt.filter((name) => !specs.has(name))).toEqual([]);
  });
});
