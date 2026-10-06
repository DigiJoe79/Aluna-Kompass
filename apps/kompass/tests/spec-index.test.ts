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

/**
 * Specs ab dem Stichtag sagen, aus welchen Bausteinen ihre Oberfläche besteht
 * (`AGENTS.md`, „Oberfläche nur aus bestehenden Bausteinen“). Bis 0.2.5 hatte
 * jede Spec ihre Leiste, Marke oder Reiterzeile selbst entworfen; 0.2.6 führt
 * sie wieder zusammen. Der Abschnitt zwingt die Frage beim Schreiben, nicht
 * erst beim Review — neue Varianten stehen dort mit „Neu, Freigabe: …“.
 * Welche Bausteine und Muster es gibt, steht in `docs/MUSTER.md`.
 */
const BAUSTEINE_AB = '2026-10-05';

function specsWithoutBuildingBlocks(files: { name: string; text: string }[]): string[] {
  return files
    .filter(({ name }) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(0, 10) >= BAUSTEINE_AB)
    .filter(({ text }) => !/^## Bausteine\s*$/m.test(text))
    .map(({ name }) => name);
}

describe('specsWithoutBuildingBlocks', () => {
  it('verlangt den Abschnitt ab dem Stichtag, nicht davor', () => {
    expect(
      specsWithoutBuildingBlocks([
        { name: '2026-10-04-alt-design.md', text: '# Alt' },
        { name: '2026-10-05-neu-design.md', text: '# Neu\n\n## Ziel' },
        { name: '2026-10-06-gut-design.md', text: '# Gut\n\n## Bausteine\n\nKeine Oberfläche.' },
      ]),
    ).toEqual(['2026-10-05-neu-design.md']);
  });

  it('zählt nur eine echte Überschrift zweiter Ebene', () => {
    expect(specsWithoutBuildingBlocks([{ name: '2026-10-07-x-design.md', text: 'Siehe ### Bausteine und „## Bausteine“ im Text' }])).toEqual([
      '2026-10-07-x-design.md',
    ]);
  });
});

describe.runIf(existsSync(SPECS))('specs in docs/intern/specs', () => {
  it('nennen ab dem Stichtag ihre Bausteine', () => {
    const files = readdirSync(SPECS)
      .filter((f) => f.endsWith('.md'))
      .map((name) => ({ name, text: readFileSync(path.join(SPECS, name), 'utf8') }));
    expect(specsWithoutBuildingBlocks(files)).toEqual([]);
  });
});
