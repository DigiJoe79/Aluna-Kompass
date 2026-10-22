import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, classNameValue, type CountedAllowlist, openingTags, read, relative, sourceFiles } from './source';
import { SIZE, TYPE_STYLE } from './type-scan';

/**
 * Farbe und Rolle von Dialog- und Seitenfenstertiteln, ihren Beschreibungen und von Abschnitten stehen im Baustein
 * (`components/ui/dialog.tsx`, `ui/sheet.tsx`, `components/section.tsx`) und nirgends sonst (docs/MUSTER.md,
 * „Schrift“; K10 Charge 1). Aufrufstellen ergänzen Layout: `flex`, `gap-*`, `items-*`, `truncate`, `sr-only`,
 * `text-pretty`. Die Bausteine selbst (`components/ui/`) sind ausgenommen, dort steht der Standard.
 *
 * Was andere Wächter schon melden, lässt dieser aus: Größe (`no-arbitrary-text`), Zeilenhöhe, Versalien, Sperrung und
 * Gewicht 500/700 (`type-style`), `font-heading` (`type-role-family`). Übrig bleiben Farbe und Rolle (`text-ink`,
 * `text-body`, `text-section` …), `font-semibold`/`font-normal`/`font-mono` und Klassen in einer Variablen.
 */
const TAGS = /DialogTitle|SheetTitle|DialogDescription|SheetDescription|Section/;
const OWN = /^(?:text|font)-/;
const SIZE_ONLY = new RegExp(`^(?:${SIZE.source})$`);
const STYLE_ONLY = new RegExp(`^(?:${TYPE_STYLE.source})$`);
const elsewhere = (c: string): boolean => c === 'text-pretty' || c === 'font-heading' || SIZE_ONLY.test(c) || STYLE_ONLY.test(c);

/** Schlüssel `datei klasse` → wie oft genau diese Klasse an Titel, Beschreibung oder Abschnitt dieser Datei steht. */
export const ALLOWED: CountedAllowlist = {
  'components/folder-tree/folder-sheet.tsx text-section': {
    count: 1,
    reason: 'Kopf des Ordnerblatts: 52 px wie seine Zeilen, Rolle Abschnitt (Designer 2026-10-10 § 3).',
  },
  'app/(shell)/admin/media/asset-detail-dialog.tsx text-body': {
    count: 1,
    reason: 'Dateiname, kein Titel: Rolle Text, lange Namen per truncate nur optisch gekürzt (Designer 2026-10-10 § 9.6). Seit Auftrag 5 (0.2.12) ohne Mono: Dateinamen sind keine Kennung.',
  },
};

/**
 * Die Farb- und Rollenklassen eines Tags; Varianten (`sm:`, `[&_a]:`) zählen mit. Ein Ausdruck ohne jede Zeichenkette
 * (`className={titleClass}`) lässt sich nicht lesen und wird als `<Name>` gemeldet — wer die Klassen in eine Variable
 * legt, geht an der Prüfung vorbei.
 */
export function ownClasses(tag: string): string[] {
  const value = classNameValue(tag);
  if (value === null) return [];
  const hasLiteral = /["'`]/.test(value);
  if (!hasLiteral && tag.search(/\sclassName=\{/) !== -1) return [`<${value.trim()}>`];
  const literals = hasLiteral ? (value.match(/(["'`])[\s\S]*?\1/g) ?? []).map((s) => s.slice(1, -1)) : [value];
  return literals
    .flatMap((s) => s.split(/\s+/))
    .map((c) => c.replace(/^["'`]+|["'`]+$/g, ''))
    .filter((c) => c && !elsewhere(c))
    .filter((c) => OWN.test(c.split(':').pop()!.replace(/^!/, '')));
}

describe('Heuristik', () => {
  it.each([
    ["<SheetTitle className={cn('flex', open && 'text-ink')}>", ['text-ink']],
    ["<SheetTitle className={cn(`flex ${open ? 'text-error' : ''}`)}>", ['text-error']],
    ['<DialogTitle className={`flex\n  text-meta\n  font-semibold`}>', ['text-meta', 'font-semibold']],
    ['<DialogTitle className={titleClass}>', ['<titleClass>']],
    ['<DialogDescription className={cn(descriptionClass)}>', ['<cn(descriptionClass)>']],
  ])('meldet %s', (tag, expected) => {
    expect(ownClasses(tag)).toEqual(expected);
  });

  it.each([
    '<DialogTitle className="flex items-center gap-2">',
    '<DialogTitle className="sr-only">',
    '<DialogTitle className="truncate text-pretty">',
    '<DialogDescription tone="body">',
    '<DialogTitle onClick={() => setOpen(false)}>',
    '<SheetTitle>',
    // Größe, Gewicht 500/700, Zeilenhöhe und Familie melden andere Wächter:
    '<DialogTitle className="font-heading text-[19px] sm:text-sm leading-tight md:font-bold">',
  ])('lässt %s durch', (tag) => {
    expect(ownClasses(tag)).toEqual([]);
  });
});

describe('keine eigene Farbe oder Rolle an Titel, Beschreibung und Abschnitt', () => {
  const hits = sourceFiles()
    .filter((file) => !relative(file).startsWith('components/ui/'))
    .flatMap((file) =>
      openingTags(read(file), TAGS).flatMap(({ line, tag }) =>
        ownClasses(tag).map((c) => ({ file: `${relative(file)} ${c}`, where: `${relative(file)}:${line} ${c}` })),
      ),
    );

  it('nur im Baustein und in der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
