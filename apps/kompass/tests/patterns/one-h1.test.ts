import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, openingTags, read, relative, sourceFiles, SRC } from './source';

/**
 * Genau ein `h1` je Seite: der Titel im `PageHeader` (Spec Seitenkopf § 2). Bis 0.2.8 war die Brotkrume das
 * `h1` und der Seitentitel `h2`; Vorleser sprangen zur Navigation statt zum Titel. Ein `<h1` an anderer Stelle
 * wäre ein zweites. Grenze: Eine Seite ganz ohne `PageHeader`-Titel fängt dieser Test nicht — das prüft der E2E
 * in `shell.spec.ts`, und nur auf den Seiten, die er besucht.
 */
const ALLOWED: Allowlist = {
  'components/page-header.tsx': 'Hier steht der Seitentitel.',
  'components/auth-card.tsx': 'Anmelde- und Einrichtungsseiten außerhalb der Schale, ohne PageHeader.',
  'app/global-error.tsx': 'Ersetzt das Wurzel-Layout samt Schale, ohne Bausteine und Tokens; ihr Titel ist das einzige h1.',
};

describe('ein h1 je Seite', () => {
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .flatMap((file) => openingTags(read(file), /h1/).map(({ line }) => ({ file: relative(file), where: `${relative(file)}:${line}` })));

  it('h1 nur im PageHeader (und auf den Seiten außerhalb der Schale)', () => {
    expect(hits.filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  it('der PageHeader hat genau eines', () => {
    expect(hits.filter(({ file }) => file === 'components/page-header.tsx')).toHaveLength(1);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(hits.map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });
});
