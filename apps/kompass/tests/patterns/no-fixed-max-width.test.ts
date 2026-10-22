import { describe, expect, it } from 'vitest';
import { type Allowlist, matchingLines, read, relative, sourceFiles, allowlistHygiene, staleKeys } from './source';

/**
 * Breiten wählt die Seite über `Page`, der Dialog über `size`, das Feld über `FormField size` (docs/MUSTER.md
 * § I und § J). Eine feste Grenze `max-w-[…px]` in einem Panel oder einer Seite war bis 0.2.6 der Weg zu
 * zehn Seitenbreiten und schmalen Inseln in breiten Seiten. Fließtext steht in `max-w-prose`.
 */
const FIXED = /max-w-\[[\d.]+(px|ch|rem|em)\]/;

export const ALLOWED: Allowlist = {
  'app/(shell)/help/[[...doc]]/page.tsx': 'Lesetext Handbuch: 72 Zeichen je Zeile (Entscheidung zum Inventar, 05.10.2026).',
  'app/(shell)/dms/new/draft-preview.tsx': 'Papiermaß der Briefvorschau (A4 im Maßstab), keine Seitenbreite.',
  'components/empty-state.tsx': 'Textblock des leeren Zustands, wie `max-w-prose` (Entscheidung zum Inventar).',
  'components/steps.tsx': 'Schrittleiste: bis 4 Schritte 880 px, 2 Schritte 440 px (Entwurf E3), keine Seitenbreite.',
  'components/drop-overlay.tsx': 'Hinweiskarte über einer Ablagefläche, keine Seitenbreite.',
  'components/folder-tree/drag-preview.tsx': 'Ziehbild eines Ordners, keine Seitenbreite.',
  'components/finance/receipt-drop.tsx': 'Dateiname im Ablagefeld, gekürzt mit `truncate`.',
};


const hits = () =>
  sourceFiles()
    .filter((file) => /\/src\/(app|components)\//.test(file) && !/\/components\/ui\//.test(file))
    .flatMap((file) => matchingLines(file, read(file), FIXED).map((where) => ({ where, file: relative(file) })));

describe('keine feste Breite in Seiten und Panels', () => {
  it('max-w-[…] steht nur in der Erlaubnisliste', () => {
    expect(hits().filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, hits().map(({ file }) => file)));
});
