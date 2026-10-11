import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, classNameValue, openingTags, read, relative, sourceFiles, SRC } from './source';
import { scanFiles } from './type-scan';

/**
 * Rollen, deren Familie das Token nicht tragen kann (K10 Charge 3, Spec § 6, Designer § 9): `text-figure`,
 * `text-amount`, `text-key` nur zusammen mit `font-mono` im selben Klassenausdruck; `text-label` nur in
 * `Overline` und `TableHeader`. Ein Klassenausdruck ist der Text zwischen den Klammern eines `cn(…)` oder
 * eine Zeichenkette in `className=`/`const … =` — gelesen als die zusammenhängenden Zeichenketten eines Ausdrucks
 * über Zeilen hinweg (`expressions`).
 */
export function expressions(text: string): { line: number; classes: string }[] {
  const out: { line: number; classes: string }[] = [];
  const re = /cn\(([\s\S]*?)\)(?=[\s;,}>)]|$)|className="([^"]*)"|=\s*'([^']*)'|=\s*`([^`]*)`/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ line: text.slice(0, m.index).split('\n').length, classes: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').replace(/\s+/g, ' ') });
  }
  return out;
}

const MONO_ROLE = /(?<![\w-])text-(?:figure|amount|key)(?![\w-])/;
const LABEL = /(?<![\w-])text-label(?![\w-])/;
const LABEL_HOME = new Set(['components/overline.tsx', 'components/ui/table.tsx']);

describe('Familie der Rollen', () => {
  it('text-figure, text-amount, text-key nur mit font-mono', () => {
    const bad = scanFiles().flatMap((file) =>
      expressions(read(file))
        .filter(({ classes }) => MONO_ROLE.test(classes) && !/(?<![\w-])font-mono(?![\w-])/.test(classes))
        .map(({ line }) => `${relative(file)}:${line}`),
    );
    expect(bad).toEqual([]);
  });

  it('text-label nur in Overline und TableHeader', () => {
    const files = [path.join(SRC, 'app'), path.join(SRC, 'components')].flatMap((dir) => sourceFiles(dir));
    const bad = files.filter((file) => !LABEL_HOME.has(relative(file)) && LABEL.test(read(file))).map(relative);
    expect(bad).toEqual([]);
  });

  it('liest einen cn-Aufruf über mehrere Zeilen als einen Ausdruck', () => {
    expect(expressions(`cn(\n  'text-key',\n  'font-mono',\n)`).map((e) => e.classes)).toEqual([` 'text-key', 'font-mono', `]);
  });
});

/** `font-heading` nur in den acht Bausteinen (Designer § 9.4, § 11: dazu die Brotkrume); DialogTitle/SheetTitle in components/ui. */
const HEADING_HOMES = new Set([
  'components/section.tsx',
  'components/page-header.tsx',
  'components/ui/dialog.tsx',
  'components/ui/sheet.tsx',
  'components/auth-card.tsx',
  'components/forbidden-card.tsx',
  'components/module-inactive-card.tsx',
  'components/shell/topbar.tsx',
]);
const HEADING_ALLOWED: Allowlist = {
  'app/(shell)/error.tsx': 'Fehlerseite der Schale ohne PageHeader; Titel als h1 in der Rolle Seitentitel (Designer § 9.4).',
  'app/(shell)/not-found.tsx': '„Nicht gefunden“ der Schale ohne PageHeader; Titel als h1 in der Rolle Seitentitel (Designer § 9.4).',
  'app/(shell)/admin/settings/settings-form.tsx': 'Kein Klassenname: Feldart `font-heading` (Auswahl der Überschriftenschrift, `case \'font-heading\'`) — der Wächter liest den Text, nicht die Klasse.',
};

describe('Familie der Überschrift', () => {
  const using = () => scanFiles().filter((file) => !HEADING_HOMES.has(relative(file)) && /(?<![\w-])font-heading(?![\w-])/.test(read(file))).map(relative);

  it('font-heading nur in den Überschriften-Bausteinen', () => {
    expect(using().filter((file) => !(file in HEADING_ALLOWED))).toEqual([]);
  });

  it('kein vorläufiger Eintrag mehr', () => {
    expect(Object.entries(HEADING_ALLOWED).filter(([, reason]) => reason.startsWith('OFFEN')).map(([file]) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const set = new Set(using());
    expect(Object.keys(HEADING_ALLOWED).filter((file) => !set.has(file))).toEqual([]);
  });
});

/**
 * `className` an `Overline` nur für Layout (Designer 2026-10-10 § 10.7): Fläche, Rahmen und Polster gehören an den
 * umgebenden `div`, Schrift kommt aus der Rolle. Erlaubt sind `flex`, `grid`, `gap`, Breite, Außenabstand und `px`/`py`
 * (der Designer nennt sie ausdrücklich; die Bereichsnavigation trägt `h-7 px-2.5`, § 8.2).
 */
const OVERLINE_NOT_LAYOUT = /^(?:bg-|text-|font-|leading-|tracking-|uppercase$|lowercase$|capitalize$|border|rounded|shadow|p-|pt-|pb-|pl-|pr-|ps-|pe-)/;

export function overlineViolations(text: string): { line: number; classes: string[] }[] {
  return openingTags(text, /Overline/).flatMap(({ line, tag }) => {
    const value = classNameValue(tag);
    if (value === null) return [];
    const literals = /["'`]/.test(value) ? (value.match(/(["'`])[\s\S]*?\1/g) ?? []).map((x) => x.slice(1, -1)) : [value];
    const bad = literals
      .flatMap((x) => x.split(/\s+/))
      .filter(Boolean)
      .filter((c) => OVERLINE_NOT_LAYOUT.test(c.split(':').pop()!.replace(/^!/, '')));
    return bad.length > 0 ? [{ line, classes: bad }] : [];
  });
}

describe('Overline nur mit Layout', () => {
  it('kein bg-, text-, font-, Rahmen oder Polster außer px/py am className einer Overline', () => {
    const bad = scanFiles().flatMap((file) => overlineViolations(read(file)).map(({ line, classes }) => `${relative(file)}:${line} ${classes.join(' ')}`));
    expect(bad).toEqual([]);
  });

  it('erkennt Fläche und Polster, lässt Layout durch', () => {
    expect(overlineViolations('<Overline as="div" className="grid gap-3 bg-table-head px-5 py-2.5">').map((v) => v.classes)).toEqual([['bg-table-head']]);
    expect(overlineViolations('<Overline className={cn(\'mb-1 pb-2\', x && \'md:text-meta\')}>').map((v) => v.classes)).toEqual([['pb-2', 'md:text-meta']]);
    expect(overlineViolations('<Overline as="div" className="flex h-7 items-center px-2.5">')).toEqual([]);
    expect(overlineViolations('<Overline>Etikett</Overline>')).toEqual([]);
  });
});
