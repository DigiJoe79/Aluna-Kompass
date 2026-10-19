import { describe, expect, it } from 'vitest';
import { type Allowlist, lineOf, read, relative, sourceFiles } from './source';

/**
 * Spaltenrollen (Entwurf E1 „Tabelle am Telefon“, Designer 2026-10-17; docs/MUSTER.md § G): Jede Liste mit
 * Tabellenkopf gibt ihren Spalten Rollen, damit sie am Telefon als Kartenzeile steht statt waagerecht zu scrollen.
 *
 * - eine Spalte `title` (sonst bleibt die Liste eine Tabelle und scrollt)
 * - hat die Liste eine Marke oder einen Zustandsschalter, heißt diese Spalte `status`
 * - höchstens drei `meta` (die Kartenzeile hat drei Plätze, `globals.css`)
 * - jede Rolle im Kopf steht auch an einer Zelle
 *
 * Geprüft je Tabelle (`<Table>` bis zum nächsten `<Table>` derselben Datei) im Quelltext, nur mit `<TableHeader`.
 */
const HEAD = /<(?:TableHead|SortableHead)\b[^>]*?\bcol="(\w+)"/g;
const CELL = /<TableCell\b[^>]*?\bcol="(\w+)"/g;
const STATUS = /<(?:StatusBadge|EntryStateBadge|PublishSwitch)\b/;

/** Tabellen mit Kopf, bewusst ohne Kartenzeile — mit Grund. */
const NO_CARDS: Allowlist = {
  'app/(shell)/finance/imports/format/csv-assistant.tsx': 'Vorschau der Rohspalten einer CSV-Datei: Die Spalten kommen aus der Datei, Rollen gibt es nicht.',
};

/** Tabellen, deren Marke kein Zustand der Zeile ist — mit Grund. */
const BADGE_NOT_STATUS: Allowlist = {
  'app/(shell)/finance/reserves/reserve-table.tsx': 'Keine Statusspalte: „inaktiv“ steht am Namen (Titel), „aufgelöst“ anstelle des Knopfs (Zeilenaktion).',
  'app/(shell)/finance/donations/notices/machine-panel.tsx': 'Die Marke „aktuell/früher“ steht im Titel neben dem Namen der unterzeichnenden Person, keine eigene Spalte.',
  'app/(shell)/contacts/contact-list.tsx': 'Rollen sind Marken in meta; „archiviert“ ist die gedämpfte Zeile mit Marke am Namen (`TableRow muted`, Joe 11.8).',
  'app/(shell)/finance/work/rules/rules-table.tsx': 'Die Marke „Kategorie inaktiv“ gehört zum Ergebnis (meta); „deaktiviert“ ist die gedämpfte Zeile (`TableRow muted`, Joe 11.8).',
  'app/(shell)/admin/finance/fiscal-years-panel.tsx': 'Die Marke „Rumpfjahr“ ist eine Eigenschaft am Namen; „abgeschlossen“ ist die gedämpfte Zeile (`TableRow muted`, Runde 3, 170).',
  'app/(shell)/admin/finance/accounts-panel.tsx': 'Die Marke „Hauptkonto“ ist eine Eigenschaft am Namen; „stillgelegt“ ist die gedämpfte Zeile (`TableRow muted`, Joe 11.8).',
  'app/(shell)/contacts/[id]/bank-accounts-panel.tsx': 'Die Marke „Gemeinschaftskonto“ gehört zum Wert „Auch bei“ (meta), kein Zustand der Zeile (Nachtrag MCP-Test § 3, Designer 2026-10-19).',
};

type Table = { file: string; line: number; text: string };

function tables(): Table[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('<TableHeader')) return [];
    const starts = [...text.matchAll(/<Table[\s>]/g)].map((m) => m.index!);
    return starts.map((start, i) => ({ file: relative(file), line: lineOf(text, start), text: text.slice(start, starts[i + 1] ?? text.length) }))
      .filter((t) => t.text.includes('<TableHeader'));
  });
}

const where = (t: Table) => `${t.file}:${t.line}`;

describe('Spaltenrollen jeder Liste (E1)', () => {
  const all = tables();
  const checked = all.filter((t) => !(t.file in NO_CARDS));

  it('jede Liste hat eine Titelspalte', () => {
    expect(checked.filter((t) => ![...t.text.matchAll(HEAD)].some((m) => m[1] === 'title')).map(where)).toEqual([]);
  });

  it('eine Liste mit Marke oder Zustandsschalter nennt ihre Spalte `status`', () => {
    expect(
      checked
        .filter((t) => !(t.file in BADGE_NOT_STATUS) && STATUS.test(t.text) && ![...t.text.matchAll(HEAD)].some((m) => m[1] === 'status'))
        .map(where),
    ).toEqual([]);
  });

  it('höchstens drei meta-Spalten', () => {
    expect(checked.filter((t) => [...t.text.matchAll(HEAD)].filter((m) => m[1] === 'meta').length > 3).map(where)).toEqual([]);
  });

  it('jede Rolle im Kopf steht auch an einer Zelle', () => {
    // Ohne `<TableCell` in der Tabelle stehen die Zeilen in einem eigenen Baustein (Belege ohne Buchung: `voucher-rows`).
    const missing = checked.filter((t) => t.text.includes('<TableCell')).flatMap((t) => {
      const cells = new Set([...t.text.matchAll(CELL)].map((m) => m[1]));
      return [...new Set([...t.text.matchAll(HEAD)].map((m) => m[1]!))]
        .filter((role) => !cells.has(role))
        .map((role) => `${where(t)} ${role}`);
    });
    expect(missing).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const files = new Set(all.map((t) => t.file));
    expect(Object.keys(NO_CARDS).filter((f) => !files.has(f))).toEqual([]);
    expect(Object.keys(BADGE_NOT_STATUS).filter((f) => !files.has(f))).toEqual([]);
  });
});
