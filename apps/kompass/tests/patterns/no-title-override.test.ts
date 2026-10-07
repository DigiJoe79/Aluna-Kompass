import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * Schrift, Größe und Farbe von Dialog- und Seitenfenstertiteln, ihren Beschreibungen und von Abschnitten
 * stehen im Baustein (`components/ui/dialog.tsx`, `ui/sheet.tsx`, `components/section.tsx`) und nirgends
 * sonst (docs/MUSTER.md, „Schrift“; K10 Charge 1). Bis 0.2.7 trugen 66 Titel `font-heading text-[19px]`
 * von Hand, acht weitere 16–18 px, und 28 Beschreibungen eine eigene Größe — eine Änderung am Standard
 * erreichte sie nicht. Aufrufstellen ergänzen Layout: `flex`, `gap-*`, `items-*`, `truncate`, `sr-only`,
 * `text-pretty`. Die Bausteine selbst (`components/ui/`) sind ausgenommen, dort steht der Standard.
 */
const TAGS = /DialogTitle|SheetTitle|DialogDescription|SheetDescription|Section/;
const TYPE = /^(?:text|font|leading|tracking)-/;
const LAYOUT = new Set(['text-pretty']);

/** Datei → genau die Schriftklassen, die dort stehen dürfen, mit Grund. Eine zweite Überschreibung fällt auf. */
type Allowed = Readonly<Record<string, { erwartet: readonly string[]; grund: string }>>;

const ALLOWED: Allowed = {
  'components/folder-tree/folder-sheet.tsx': {
    erwartet: ['font-heading', 'text-[17px]', 'font-semibold', 'text-ink'],
    grund: 'Kopf des Ordnerblatts: 52 px hoch wie seine Zeilen, 17/600 — benannte Ausnahme Navigation und Ordnerblatt (MUSTER § I).',
  },
  'app/(shell)/admin/media/asset-detail-dialog.tsx': {
    erwartet: ['font-mono', 'text-[14px]', 'font-medium'],
    grund: 'Dateiname, kein Titel: Mono 14/500 wie jede Dateikennung, lange Namen per truncate nur optisch gekürzt (Joe und Designer 2026-10-07).',
  },
};

/** Der Wert von `className=` in einem öffnenden Tag: der Text eines Strings oder der Ausdruck in `{ … }`. */
export function classNameValue(tag: string): string | null {
  const at = tag.search(/\sclassName=/);
  if (at === -1) return null;
  const start = tag.indexOf('=', at) + 1;
  const open = tag[start];
  if (open === '"' || open === "'") return tag.slice(start + 1, tag.indexOf(open, start + 1));
  if (open !== '{') return null;
  let depth = 0;
  for (let i = start; i < tag.length; i += 1) {
    if (tag[i] === '{') depth += 1;
    else if (tag[i] === '}' && (depth -= 1) === 0) return tag.slice(start + 1, i);
  }
  return null;
}

/**
 * Die Schriftklassen eines Tags; Varianten (`sm:`, `[&_a]:`) zählen mit, die erlaubten Layoutklassen nicht.
 * Ein Ausdruck ohne jede Zeichenkette (`className={titleClass}`) lässt sich nicht lesen und wird als
 * `<Name>` gemeldet — wer die Klassen in eine Variable legt, geht an der Prüfung vorbei.
 */
export function typeClasses(tag: string): string[] {
  const value = classNameValue(tag);
  if (value === null) return [];
  const hasLiteral = /["'`]/.test(value);
  if (!hasLiteral && tag.search(/\sclassName=\{/) !== -1) return [`<${value.trim()}>`];
  const literals = hasLiteral ? (value.match(/(["'`])[\s\S]*?\1/g) ?? []).map((s) => s.slice(1, -1)) : [value];
  return literals
    .flatMap((s) => s.split(/\s+/))
    .map((c) => c.replace(/^["'`]+|["'`]+$/g, ''))
    .filter(Boolean)
    .filter((c) => {
      const base = c.split(':').pop()!.replace(/^!/, '');
      return TYPE.test(base) && !LAYOUT.has(base);
    });
}

/** Die Fundstellen, die nicht durch die Erlaubnisliste gedeckt sind: unerlaubte Dateien und abweichende Klassen. */
export function unexpected(hits: { file: string; where: string; classes: string[] }[], allowed: Allowed): string[] {
  const byFile = new Map<string, { where: string[]; classes: string[] }>();
  for (const { file, where, classes } of hits) {
    const entry = byFile.get(file) ?? { where: [], classes: [] };
    entry.where.push(where);
    entry.classes.push(...classes);
    byFile.set(file, entry);
  }
  const problems: string[] = [];
  for (const [file, { where, classes }] of byFile) {
    const rule = allowed[file];
    if (!rule) problems.push(...where);
    else if ([...classes].sort().join(' ') !== [...rule.erwartet].sort().join(' ')) problems.push(`${file}: erwartet ${rule.erwartet.join(' ')}, gefunden ${classes.join(' ')}`);
  }
  return problems;
}

describe('Heuristik', () => {
  it.each([
    ['<DialogTitle className="font-heading text-[19px]">', ['font-heading', 'text-[19px]']],
    ['<SheetTitle className={cn(\'flex\', open && \'text-ink\')}>', ['text-ink']],
    ['<DialogDescription className="sm:text-[14px]">', ['sm:text-[14px]']],
    ['<Section title="A" className="leading-tight">', ['leading-tight']],
    // Lücken, die der erste Entwurf ließ:
    ["<SheetTitle className={cn(`flex ${open ? 'text-error' : ''}`)}>", ['text-error']],
    ['<DialogTitle className={`flex\n  text-[17px]\n  font-semibold`}>', ['text-[17px]', 'font-semibold']],
    ['<DialogTitle className={titleClass}>', ['<titleClass>']],
    ['<DialogDescription className={cn(descriptionClass)}>', ['<cn(descriptionClass)>']],
  ])('meldet %s', (tag, expected) => {
    expect(typeClasses(tag)).toEqual(expected);
  });

  it.each([
    '<DialogTitle className="flex items-center gap-2">',
    '<DialogTitle className="sr-only">',
    '<DialogTitle className="truncate text-pretty">',
    '<DialogDescription tone="body">',
    '<DialogTitle onClick={() => setOpen(false)}>',
    '<SheetTitle>',
  ])('lässt %s durch', (tag) => {
    expect(typeClasses(tag)).toEqual([]);
  });
});

describe('Erlaubnisliste genau', () => {
  const allowed: Allowed = { 'a.tsx': { erwartet: ['text-[17px]'], grund: 'x' } };
  it('lässt genau die erwarteten Klassen durch', () => {
    expect(unexpected([{ file: 'a.tsx', where: 'a.tsx:1 text-[17px]', classes: ['text-[17px]'] }], allowed)).toEqual([]);
  });
  it('meldet eine zweite Überschreibung in einer erlaubten Datei', () => {
    expect(unexpected([
      { file: 'a.tsx', where: 'a.tsx:1 text-[17px]', classes: ['text-[17px]'] },
      { file: 'a.tsx', where: 'a.tsx:9 text-error', classes: ['text-error'] },
    ], allowed)).toHaveLength(1);
  });
  it('meldet eine Datei außerhalb der Liste', () => {
    expect(unexpected([{ file: 'b.tsx', where: 'b.tsx:3 text-ink', classes: ['text-ink'] }], allowed)).toEqual(['b.tsx:3 text-ink']);
  });
});

describe('keine eigene Schrift an Titel, Beschreibung und Abschnitt', () => {
  const hits = sourceFiles()
    .filter((file) => !relative(file).startsWith('components/ui/'))
    .flatMap((file) =>
      openingTags(read(file), TAGS)
        .map(({ line, tag }) => ({ line, classes: typeClasses(tag) }))
        .filter(({ classes }) => classes.length > 0)
        .map(({ line, classes }) => ({ file: relative(file), classes, where: `${relative(file)}:${line} ${classes.join(' ')}` })),
    );

  it('Schriftklassen stehen nur im Baustein und in der Erlaubnisliste, genau wie dort erwartet', () => {
    expect(unexpected(hits, ALLOWED)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(hits.map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });
});
