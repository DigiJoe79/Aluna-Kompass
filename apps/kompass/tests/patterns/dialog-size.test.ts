import { describe, expect, it } from 'vitest';
import { type Allowlist, openingTags, read, relative, sourceFiles } from './source';

/**
 * Dialoge haben vier Größen, Seitenfenster zwei (docs/MUSTER.md § I, Handoff Konsistenz § 8a.4 und § 8c):
 * `DialogContent size` bzw. `SheetContent size` setzt Breite, Polster und das Verhalten auf dem Telefon. Bis
 * 0.2.6 gab es achtzehn Dialogbreiten, teils über `sm:max-w-[…]`, teils über `w-[…]`, und jedes Polster mit
 * eigenem `--dialog-pad`.
 */
const FORBIDDEN = /max-w-|(?<![\w-])w-\[|--dialog-pad|(?<![\w-])p-[0-9]/;

const ALLOWED: Allowlist = {
  'components/ui/command.tsx': 'Grundbaustein der Befehlsliste: Palette, oben verankert.',
  'components/shell/command-palette.tsx': 'Befehlspalette, oben verankert (Entscheidung zum Inventar, 05.10.2026).',
};


const tags = () =>
  sourceFiles()
    .filter((file) => !/components\/ui\/(dialog|sheet)\.tsx$/.test(file))
    .flatMap((file) =>
      openingTags(read(file), /DialogContent|SheetContent/).map(({ line, tag }) => ({ where: `${relative(file)}:${line}`, file: relative(file), tag })),
    );
const wrong = ({ tag }: { tag: string }) => !/\ssize=/.test(tag) || FORBIDDEN.test(tag);

describe('Dialog- und Fenstergröße über size', () => {
  it('jedes DialogContent und SheetContent trägt size und keine eigene Breite oder Polster', () => {
    expect(tags().filter((t) => wrong(t) && !(t.file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(tags().filter(wrong).map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });
});
