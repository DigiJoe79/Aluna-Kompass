import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, classNameValue, openingTags, read, relative, sourceFiles, SRC } from './source';

/**
 * Überschriften kommen aus Bausteinen (K10 Charge 3, Spec § 6, Designer § 9.5): `PageHeader`, `DialogTitle`/
 * `SheetTitle`, `Section`/`SectionHeading`, Sperrkarten. Kein `h2`/`h3`/`h4` mit eigener Klasse unter `src/app` und
 * `src/components` — außer `sr-only` (Überschrift nur für Vorleser). Die Bausteine selbst sind ausgenommen.
 */
// Dazu `DialogTitle`/`SheetTitle` aus `components/ui` (Designer § 9.4); sonst gilt der Wächter auch dort (§ 14).
const HOMES = new Set(['components/section.tsx', 'components/page-header.tsx', 'components/auth-card.tsx', 'components/forbidden-card.tsx', 'components/module-inactive-card.tsx', 'components/ui/dialog.tsx', 'components/ui/sheet.tsx']);

const ALLOWED: Allowlist = {
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

  it('kein vorläufiger Eintrag mehr', () => {
    expect(Object.entries(ALLOWED).filter(([, reason]) => reason.startsWith('OFFEN')).map(([file]) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(hits().map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });

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
