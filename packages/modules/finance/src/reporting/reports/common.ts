import { notFound, type DbOrTx, type Failure } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { formatAmount } from '../../format/amount';
import { fiscalYearForInternal, isShortFiscalYear } from '../../ledger/fiscal-years';
import type { Sphere } from '../../ledger/queries';
import { accountIdsOfPeriodInternal } from '../../ledger/queries';
import { financeFiscalYears, type FinanceFiscalYearRow } from '../../schema';
import { typstText } from '../../typst-pure';
import { dayBefore } from '../other-assets';
import type { ReportParams } from '../types';

/**
 * Gemeinsames der Kernberichte (Rechenschaft A2): Geschäftsjahr und Stichtag aus den Parametern, Vorjahr,
 * Typst-Bausteine. Die Texte auf dem Papier sind deutsch wie die übrigen Vorlagen der Finanzen (Prinzip 7: das
 * Papier ist kein Bildschirmtext) und sprechen dieselbe Sprache wie die Oberfläche („Bereich“, „offene Zahlungen“).
 */

export interface ReportYear {
  id: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  /** Rumpfjahr. */
  short: boolean;
}

const yearView = (row: FinanceFiscalYearRow): ReportYear => ({ id: row.id, designation: row.designation, startsOn: row.startsOn, endsOn: row.endsOn, short: isShortFiscalYear(row) });

export function yearRowInternal(db: DbOrTx, id: string): FinanceFiscalYearRow | null {
  return db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get() ?? null;
}

/** Das Geschäftsjahr des Berichts; `checkParams` hat sichergestellt, dass es da ist. */
export function reportYearInternal(db: DbOrTx, id: string): ReportYear {
  const row = yearRowInternal(db, id);
  if (!row) throw new Error(`Geschäftsjahr ${id} fehlt`);
  return yearView(row);
}

/**
 * Die Konten eines Berichts zu einem Stichtag — eine Liste für Kassenbericht, Vermögensübersicht, Kontenabstimmung und
 * Schritt 1 des Jahresabschlusses (Designer Runde 7, 248/244, 272/295): ein Konto gehört dazu, wenn es im Zeitraum
 * bewegt wurde, am Anfang oder Ende einen Bestand hat, oder aktiv und bis zum Stichtag eröffnet ist — auch mit 0,00.
 * Ein Konto, das erst später eröffnet wurde oder ohne Bestand und Bewegung stillliegt, fehlt überall gleich.
 * Reihenfolge nach Namen. Re-Export von `accountIdsOfPeriodInternal`.
 */
export function reportAccountIdsInternal(db: DbOrTx, range: { from: string; to: string }): string[] {
  return accountIdsOfPeriodInternal(db, range);
}

/** Das Geschäftsjahr unmittelbar davor (endet vor dem Beginn), sonst `null` — im ersten Jahr gibt es keins. */
export function previousYearInternal(db: DbOrTx, year: ReportYear): ReportYear | null {
  const row = fiscalYearForInternal(db, dayBefore(year.startsOn));
  return row ? yearView(row) : null;
}

/** Nur das Geschäftsjahr: `{ fiscalYearId }`. */
export const yearParamsSchema: z.ZodType<ReportParams> = z.object({ fiscalYearId: z.string().min(1) });

/** Geschäftsjahr (Stichtag = Ende) oder ein Stichtag (nur MCP) — genau eines. */
export const yearOrDateParamsSchema: z.ZodType<ReportParams> = z.union([z.object({ fiscalYearId: z.string().min(1) }).strict(), z.object({ date: z.iso.date() }).strict()]);

/** Unbekanntes Geschäftsjahr, oder ein Stichtag außerhalb aller Geschäftsjahre → `notFound`. */
export function checkYearOrDate(db: DbOrTx, params: ReportParams): Failure | null {
  if (params.fiscalYearId !== undefined) return yearRowInternal(db, params.fiscalYearId) ? null : notFound('financeFiscalYear', params.fiscalYearId);
  if (params.date !== undefined) return fiscalYearForInternal(db, params.date) ? null : notFound('financeFiscalYear', params.date);
  return null;
}

/** Stichtag des Berichts: das Ende des Jahres oder der genannte Tag. */
export function reportDateInternal(db: DbOrTx, params: ReportParams): string {
  if (params.date !== undefined) return params.date;
  return reportYearInternal(db, params.fiscalYearId!).endsOn;
}

/** Das Geschäftsjahr, in das der Stichtag fällt. */
export function yearIdsOfDate(db: DbOrTx, params: ReportParams): string[] {
  if (params.fiscalYearId !== undefined) return [params.fiscalYearId];
  const row = params.date !== undefined ? fiscalYearForInternal(db, params.date) : null;
  return row ? [row.id] : [];
}

// ── Papier ─────────────────────────────────────────────────────────────────

export const SPHERE_ORDER: readonly Sphere[] = ['ideal', 'assetManagement', 'purposeOperation', 'business'];

/** Die Bereiche auf dem Papier — dieselben Wörter wie in der Oberfläche (`finance.spheres.*`). */
export const SPHERE_TITLE: Record<Sphere, string> = {
  ideal: 'Ideeller Bereich',
  assetManagement: 'Vermögensverwaltung',
  purposeOperation: 'Zweckbetrieb',
  business: 'Wirtschaftlicher Geschäftsbetrieb',
};

/** Betrag in einer Tabellenzelle, ohne „€“ (der Kopf sagt „in €“), rechtsbündig. */
export const amountCell = (cents: number): string => `table.cell(align: right)[${formatAmount(cents)}]`;
/** Eine Anzahl in einer Tabellenzelle, rechtsbündig in ihrer Spalte wie die Beträge (Befund 18a). */
export const countCell = (count: number): string => `table.cell(align: right)[${typstText(String(count))}]`;
/** Eine leere Zelle — wo ein Wert fehlt, nicht „0“. */
export const emptyCell = '[]';
/** Freitext oder ein Name als Zelle; nichts darin wirkt als Markup. */
export const textCell = (value: string): string => `[${typstText(value)}]`;
/** Hervorgehobene Zelle (Summe, Ergebnis). */
export const strongCell = (value: string): string => `[*${typstText(value)}*]`;
export const strongAmountCell = (cents: number): string => `table.cell(align: right)[*${formatAmount(cents)}*]`;
/** Die Einheit über den Betragsspalten einer Tabelle, deren erste Spalte etwas anderes trägt (Rücklagenspiegel, Abnahme B1). */
export const unitLine = (unit = 'in €'): string => `#align(right)[#text(size: 8pt)[${typstText(unit)}]]`;
/** Eine Zeile über alle Spalten (Abschnitt in der Tabelle). */
export const spanRow = (columns: number, value: string): string => `table.cell(colspan: ${columns})[_${typstText(value)}_]`;

/** Eine Tabelle; `columns` legt die Spalten fest (nie `auto` für Beträge). */
export function table(columns: string, header: readonly string[], rows: readonly string[][], opts: { rightHeads?: readonly number[] } = {}): string {
  // `rightHeads`: Spaltenköpfe über Beträgen rechtsbündig wie die Werte (Abnahme B1, Rücklagenspiegel und Zweckmittel).
  // „in €“ als Kopf einer Betragsspalte steht immer rechts über den Zahlen (Designer Runde 8, 271/274); als erste Spalte
  // ist es das Etikett der Zeilen und bleibt links.
  const right = (h: string, i: number) => opts.rightHeads?.includes(i) || (i > 0 && h === 'in €');
  const head = (h: string, i: number) => (right(h, i) ? `table.cell(align: right)[${typstText(h)}]` : `[${typstText(h)}]`);
  return [
    `#table(columns: ${columns},`,
    `  table.header(${header.map(head).join(', ')}),`,
    ...rows.map((cells) => `  ${cells.join(', ')},`),
    ')',
  ].join('\n');
}

export const heading = (level: number, value: string): string => `${'='.repeat(level)} ${typstText(value)}`;
export const paragraph = (value: string): string => typstText(value);
export const small = (value: string): string => `#text(size: 8pt)[${typstText(value)}]`;
