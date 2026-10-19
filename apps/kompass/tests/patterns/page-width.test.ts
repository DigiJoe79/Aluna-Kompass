import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { type Allowlist, read, relative, sourceFiles, SRC } from './source';
import path from 'node:path';

/**
 * Jede Seite der Schale wählt eine der drei Breiten über `<Page width>` (docs/MUSTER.md § I, Handoff Konsistenz
 * § 8a): `task` 720, `standard` 1200, `full`. Bis 0.2.6 gab es zehn Seitenbreiten, und Tier, Projekt, Kontakt
 * und Buchung wurden auf großen Schirmen überbreit. Geprüft wird jede `page.tsx` unter `app/(shell)` und die
 * Fehlerseiten der Schale.
 */
const ALLOWED: Allowlist = {
  'app/(shell)/finance/page.tsx': 'Weiterleitung auf den ersten Finanzbereich, rendert nichts.',
  'app/(shell)/site/template/page.tsx': 'Weiterleitung (`redirect`), rendert nichts.',
  'app/(shell)/[...catchAll]/page.tsx': 'Ruft nur `notFound()`; die Seite dazu ist `not-found.tsx`.',
  'app/(shell)/site/publish/preview/page.tsx': 'Inhalt eines iframes der Vorschau, keine Seite der Schale.',
};


const SHELL = path.join(SRC, 'app/(shell)');
const pages = () =>
  sourceFiles(SHELL).filter((file) => /\/(page|error|not-found)\.tsx$/.test(file)).map((file) => ({ file: relative(file), text: read(file) }));

describe('Seitenbreite über Page', () => {
  it('jede Seite rendert <Page width=…>', () => {
    const violations = pages().filter(({ file, text }) => !/<Page\s+width=/.test(text) && !(file in ALLOWED));
    expect(violations.map(({ file }) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const without = new Set(pages().filter(({ text }) => !/<Page\s+width=/.test(text)).map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !without.has(file))).toEqual([]);
  });
});

/**
 * Listen ab fünf Spalten stehen in `full` (MUSTER § I; Joe 11.4): Bei `standard` scrollte die Tabelle der
 * hochgeladenen Auszüge (8 Spalten) waagerecht, „Verwerfen“ und „Endsaldo nachtragen“ lagen außer Sicht. Eine
 * `page.tsx`, deren Tabelle (in der Seite oder einer Datei ihres Ordners, die sie einbindet) fünf oder mehr
 * Spaltenköpfe hat, rendert die Liste in `<Page width="full">` — Zweige ohne Liste (kein Recht, leer) dürfen schmal
 * bleiben. Sonst steht sie hier mit Grund: Detail- und Einstellungsseiten mit einer Tabelle als Abschnitt.
 */
const WIDE_ALLOWED: Allowlist = {
  'app/(shell)/admin/dms/page.tsx': 'Einstellungsseite (PanelNav), die Tabellen der Arten und Regeln sind Abschnitte (MUSTER § D).',
  'app/(shell)/admin/finance/page.tsx': 'Einstellungsseite (PanelNav), Konten, Kategorien und Zwecke sind Abschnitte (MUSTER § D).',
  'app/(shell)/admin/members/page.tsx': 'Einstellungsseite (PanelNav), Mitgliedsarten und Mahnstufen sind Abschnitte (MUSTER § D, Handoff Mitglieder 7b/7c).',
  'app/(shell)/members/[id]/page.tsx': 'Detail eines Mitglieds (Stammdaten wie Partner), die Beiträge sind eine Nebenliste neben dem Formular (Handoff Mitglieder D1, 3c).',
  'app/(shell)/finance/entries/[id]/page.tsx': 'Detail einer Buchung, die Aufteilungen sind ein Abschnitt der Lesesicht.',
  'app/(shell)/finance/direct-debit/mandates/[id]/page.tsx': 'Mandat (Vorgang in einer Spalte, Handoff 2a § 1.4): die Rückgaben sind eine Nebenliste unter den Angaben.',
  'app/(shell)/finance/direct-debit/pledges/[id]/page.tsx': 'Zusage (Stammdaten wie das Mitglied, Handoff 2a § 1.5): die Raten sind eine Nebenliste neben dem Formular.',
  'app/(shell)/finance/direct-debit/runs/[id]/page.tsx': 'Einzug (Vorgang, Handoff 2a § 1.3): die Posten mit Summe sind ein Abschnitt unter den Schritten.',
};

/** Die Datei und die Dateien ihres Ordners, die sie über `./name` einbindet, auch über mehrere Stufen. */
function withLocalImports(file: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = read(file);
  const next = [...text.matchAll(/from '\.\/([\w-]+)'/g)]
    .flatMap((m) => ['.tsx', '.ts'].map((ext) => path.join(path.dirname(file), m[1]! + ext)))
    .filter((candidate) => existsSync(candidate));
  return [file, ...next.flatMap((candidate) => withLocalImports(candidate, seen))];
}

/** Die meisten Spaltenköpfe (`TableHead`, `SortableHead`) eines `TableHeader` in diesen Dateien. */
export function widestTable(files: string[]): number {
  return Math.max(
    0,
    ...files.flatMap((file) =>
      [...read(file).matchAll(/<TableHeader[\s>][\s\S]*?<\/TableHeader>/g)].map((m) => (m[0].match(/<(?:TableHead|SortableHead)[\s/>]/g) ?? []).length),
    ),
  );
}

const standardPages = () =>
  sourceFiles(SHELL)
    .filter((file) => /\/page\.tsx$/.test(file) && !/<Page\s+width="full"/.test(read(file)))
    .map((file) => ({ file: relative(file), columns: widestTable(withLocalImports(file)) }));

describe('Listen ab fünf Spalten in voller Breite', () => {
  it('keine schmale Seite mit einer Tabelle ab fünf Spalten ohne Ausnahme', () => {
    const violations = standardPages().filter(({ file, columns }) => columns >= 5 && !(file in WIDE_ALLOWED));
    expect(violations.map(({ file, columns }) => `${file} (${columns} Spalten)`)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const wide = new Set(standardPages().filter(({ columns }) => columns >= 5).map(({ file }) => file));
    expect(Object.keys(WIDE_ALLOWED).filter((file) => !wide.has(file))).toEqual([]);
  });
});
