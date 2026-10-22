import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, classNameValue, openingTags, read, relative, sourceFiles, SRC, allowlistHygiene, staleKeys } from './source';

/**
 * Überschriften kommen aus Bausteinen (K10 Charge 3, Spec § 6, Designer § 9.5): `PageHeader`, `DialogTitle`/
 * `SheetTitle`, `Section`/`SectionHeading`, Sperrkarten. Kein `h2`/`h3`/`h4` mit eigener Klasse unter `src/app` und
 * `src/components` — außer `sr-only` (Überschrift nur für Vorleser). Die Bausteine selbst sind ausgenommen.
 */
// Dazu `DialogTitle`/`SheetTitle` aus `components/ui` (Designer § 9.4); sonst gilt der Wächter auch dort (§ 14).
const HOMES = new Set(['components/section.tsx', 'components/page-header.tsx', 'components/auth-card.tsx', 'components/forbidden-card.tsx', 'components/module-inactive-card.tsx', 'components/ui/dialog.tsx', 'components/ui/sheet.tsx']);

export const ALLOWED: Allowlist = {
  'components/shell/help-panel.tsx': 'Titel der Hilfe als Nebenspalte (Entwurf E4): wie `SheetTitle`, aber ohne Dialog, deshalb ein eigenes h2 mit tabIndex für den Fokus beim Öffnen.',
};

function hits(): { file: string; where: string }[] {
  return [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => !HOMES.has(relative(file)))
    .flatMap((file) =>
      openingTags(read(file), /h2|h3|h4/)
        .filter(({ tag }) => {
          const value = classNameValue(tag);
          return value !== null && value.trim() !== 'sr-only';
        })
        .map(({ line }) => ({ file: relative(file), where: `${relative(file)}:${line}` })),
    );
}

describe('Überschriften aus Bausteinen', () => {
  it('kein h2–h4 mit eigener Klasse', () => {
    expect(hits().filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });


  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, hits().map(({ file }) => file)));

  it('jedes aria-labelledby mit fester id hat sein Ziel in derselben Datei', () => {
    const files = [path.join(SRC, 'app'), path.join(SRC, 'components')].flatMap((dir) => sourceFiles(dir));
    const bad = files.flatMap((file) => {
      const text = read(file);
      return [...text.matchAll(/aria-labelledby="([\w-]+)"/g)]
        .filter((m) => !new RegExp(`(?:\\bid|headingId)="${m[1]}"`).test(text))
        .map((m) => `${relative(file)}: ${m[1]}`);
    });
    expect(bad).toEqual([]);
  });
});
