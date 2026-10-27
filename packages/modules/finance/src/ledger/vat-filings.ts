import { DEFAULT_TIME_ZONE, invalid, isoDayInZone, isoNow, newId, ok, requirePermission, timeZoneOf, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { documents } from '@kompass/module-dms';
import { financeAllocationCorrections, financeAllocationLines, financeEntries, financeVatFilings, type FinanceVatFilingRow } from '../schema';
import { requireFinanceRead } from './access';
import {
  parseVatPeriod,
  vatAdvancePeriodKindInternal,
  reverseChargeAmountsInternal,
  vatAdvancePeriodsInternal,
  vatDigestOfParts,
  vatPeriodLinesInternal,
  vatPeriodPartsInternal,
  vatPeriodOf,
  vatReturnDueOnInternal,
  vatReturnRequiredInternal,
  type VatPartOverride,
  type VatPeriodState,
} from './vat-periods';
import { vatProfileAt } from './vat-settings';
import { vatFiguresDiffer, vatFiguresOfPeriodInternal } from './vat-figures';

/**
 * Abgabe je Umsatzsteuer-Zeitraum (Spec E6 Teil 4, Plan E6a Task 5): Voranmeldung (`'YYYY-Qn'`, `'YYYY-MM'`) und
 * Jahreserklärung (`'YYYY'`). Eine zweite Abgabe ist die berichtigte Anmeldung (Kennzahl 10 = 1). Ändern sich danach
 * die Kennzahlen des Zeitraums (neue Zeile, Storno, Kennzeichen, Leistungsdatum in einen anderen Zeitraum — N14), ist die
 * Berichtigung fällig (§ 153 Abs. 1 AO) und steht als Frist da, bis sie abgegeben ist.
 */

/** E6b: die Fächer der Ablage an einer Abgabe — abgegebene Fassung (nur mit festgeschriebener Fassung) und ELSTER-Protokoll. */
export const VAT_FILING_DOCUMENT_SLOTS = ['filedReturn', 'transmissionProtocol'] as const;
export type VatFilingDocumentSlot = (typeof VAT_FILING_DOCUMENT_SLOTS)[number];
export interface VatFilingView {
  id: string;
  period: string;
  filedOn: string;
  amendment: boolean;
  at: string;
  /** E6b: Abbild der Kennzahlen bei der Abgabe (Cent je Quelle), `null` bei Abgaben vor E6b. */
  figures: Record<string, number> | null;
  /** E6b: die festgeschriebene Fassung des Berichts mit dem Datenstand der Abgabe, sonst `null`. */
  reportId: string | null;
  documents: Partial<Record<VatFilingDocumentSlot, { documentId: string; documentNumber: string | null }>>;
}
/** Was eine Berichtigung auslöste (Board 5a): die jüngste geänderte Buchung, `more` weitere betroffene Buchungen. */
export interface VatAmendmentCause { entryId: string; entryNumber: string | null; change: 'booked' | 'corrected' | 'reversed'; changedOn: string; more: number }
export interface VatPeriodView extends VatPeriodState { filings: VatFilingView[]; amendmentDue: boolean; amendmentCause: VatAmendmentCause | null }

/** Ohne Rechteprüfung: eine Abgabe mit Abbild, Fassung und Ablage (Nummern aus der Akte). */
export function vatFilingViewInternal(db: DbOrTx, row: FinanceVatFilingRow): VatFilingView {
  const ids = { filedReturn: row.filedReturnDocumentId, transmissionProtocol: row.transmissionProtocolDocumentId };
  const known = Object.values(ids).filter((id): id is string => id !== null);
  const numbers = new Map(known.length > 0 ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, known)).all().map((d) => [d.id, d.number] as const) : []);
  const docs: VatFilingView['documents'] = {};
  for (const slot of VAT_FILING_DOCUMENT_SLOTS) {
    const id = ids[slot];
    if (id) docs[slot] = { documentId: id, documentNumber: numbers.get(id) ?? null };
  }
  return { id: row.id, period: row.period, filedOn: row.filedOn, amendment: row.amendment, at: row.at, figures: row.figures ? (JSON.parse(row.figures) as Record<string, number>) : null, reportId: row.reportId, documents: docs };
}

/** Ohne Rechteprüfung: alle Abgaben je Zeitraum, älteste zuerst. */
export function vatFilingsOfInternal(db: DbOrTx, period: string): FinanceVatFilingRow[] {
  return filingsOf(db, [period]).get(period) ?? [];
}

function filingsOf(db: DbOrTx, periods: readonly string[]): Map<string, FinanceVatFilingRow[]> {
  const rows = periods.length > 0 ? db.select().from(financeVatFilings).where(inArray(financeVatFilings.period, [...periods])).orderBy(asc(financeVatFilings.at), asc(financeVatFilings.id)).all() : [];
  const map = new Map<string, FinanceVatFilingRow[]>();
  for (const row of rows) map.set(row.period, [...(map.get(row.period) ?? []), row]);
  return map;
}

/**
 * Weicht der Zeitraum heute von der letzten Abgabe ab? N14 (Joe 2026-10-27): verglichen werden die festgehaltenen
 * Kennzahlen (`figures`, `vatFiguresDiffer` — § 153 AO), nicht die Zeilen; mit `override` so, wie die Zeile nach einer
 * beantragten Korrektur stünde. Eine Abgabe ohne Kennzahlen (vor E6b) vergleicht wie damals den Fingerabdruck der
 * Zeilen; ohne beides (Übertrag): nie.
 */
function lastFilingDiffers(db: DbOrTx, period: string, last: FinanceVatFilingRow | undefined, override?: VatPartOverride): boolean {
  if (!last) return false;
  if (last.figures) return vatFiguresDiffer(JSON.parse(last.figures) as Record<string, number>, vatFiguresOfPeriodInternal(db, period, override));
  return !!last.linesDigest && last.linesDigest !== vatDigestOfParts(vatPeriodPartsInternal(db, period, override));
}

/** Die letzte Abgabe weicht ab (`lastFilingDiffers`): die Berichtigung ist fällig. */
function amendmentDueOf(db: DbOrTx, period: string, filings: readonly FinanceVatFilingRow[]): boolean {
  return lastFilingDiffers(db, period, filings.at(-1));
}

/**
 * Ohne Rechteprüfung: Darf für den Zeitraum mit Abgaben eine weitere eingetragen werden (N6)? Nur, wenn die Berichtigung
 * fällig ist — dieselbe Regel wie `amendmentDue` und die Frist `vatAmendment`. Ohne Fingerabdruck an der letzten Abgabe
 * (Übertrag) weiß Kompass das nicht und lässt die Berichtigung zu.
 */
export function vatFurtherFilingAllowedInternal(db: DbOrTx, period: string, filings: readonly FinanceVatFilingRow[]): boolean {
  const last = filings.at(-1);
  return (!last?.linesDigest && !last?.figures) || amendmentDueOf(db, period, filings);
}


/** Ohne Rechteprüfung: die Jahreserklärung eines Kalenderjahres als Zeitraum (Beträge über das Jahr). */
function annualStateInternal(db: DbOrTx, calendarYear: number): VatPeriodState {
  const range = parseVatPeriod(String(calendarYear))!;
  const required = vatReturnRequiredInternal(db, calendarYear);
  const lines = vatPeriodLinesInternal(db, { from: range.startsOn, to: range.endsOn });
  // N5: Steuer wie die Quartale und die Jahreserklärung (`vatSummary`) — je Kennzeichen und Satz auf die Summe gerechnet.
  const amounts = reverseChargeAmountsInternal(db, lines);
  const regular = vatProfileAt(db, range.endsOn).taxation === 'regular' || vatProfileAt(db, range.startsOn).taxation === 'regular';
  return { ...range, required, reason: required ? (regular ? 'regular' : 'section18_4a') : null, dueOn: required ? vatReturnDueOnInternal(db, calendarYear) : null, amounts };
}

const lineIdOf = (part: string) => part.slice(0, part.indexOf('|'));

/**
 * Ohne Rechteprüfung: die Ursache einer Berichtigung — Vergleich des Abbilds der letzten Abgabe mit den Zeilen heute
 * (Entscheidung 17: aus dem Abbild, nicht aus Zeitstempeln, sonst fiele eine Zeile nicht auf, die eine Korrektur aus dem
 * Zeitraum geschoben hat). Neue Zeile: `booked`, bzw. `reversed`, wenn ihre Buchung eine andere zurücknimmt — dann
 * nennt die Ursache die zurückgenommene Buchung; geänderte oder verschwundene Zeile: `corrected`. `changedOn` ist der Tag
 * des Festschreibens bzw. der jüngsten angewandten Korrektur der Zeile in der Zeitzone des Vereins; die jüngste Ursache
 * gewinnt. Ohne Abbild (Übertrag, Abgaben vor 0.4.0) oder ohne Abweichung: `null`.
 */
export function vatAmendmentCauseInternal(db: DbOrTx, period: string, timeZone: string = DEFAULT_TIME_ZONE): VatAmendmentCause | null {
  const last = db.select().from(financeVatFilings).where(eq(financeVatFilings.period, period)).orderBy(desc(financeVatFilings.at), desc(financeVatFilings.id)).get();
  if (!last?.linesSnapshot) return null;
  const before = new Map((JSON.parse(last.linesSnapshot) as string[]).map((p) => [lineIdOf(p), p] as const));
  const now = new Map(vatPeriodPartsInternal(db, period).map((p) => [lineIdOf(p), p] as const));
  const causes = new Map<string, { change: VatAmendmentCause['change']; at: string }>();
  const note = (entryId: string, change: VatAmendmentCause['change'], at: string) => {
    const known = causes.get(entryId);
    if (!known || known.at < at) causes.set(entryId, { change, at });
  };
  const entryOfLine = (lineId: string) => db.select({ entryId: financeAllocationLines.entryId }).from(financeAllocationLines).where(eq(financeAllocationLines.id, lineId)).get()?.entryId ?? null;
  for (const [lineId, part] of now) {
    if (before.get(lineId) === part) continue;
    const entryId = entryOfLine(lineId);
    if (!entryId) continue;
    if (!before.has(lineId)) {
      const entry = db.select({ finalizedAt: financeEntries.finalizedAt, reversesEntryId: financeEntries.reversesEntryId }).from(financeEntries).where(eq(financeEntries.id, entryId)).get();
      if (entry?.reversesEntryId) note(entry.reversesEntryId, 'reversed', entry.finalizedAt ?? '');
      else note(entryId, 'booked', entry?.finalizedAt ?? '');
      continue;
    }
    note(entryId, 'corrected', lastAppliedCorrectionAt(db, lineId));
  }
  for (const lineId of before.keys()) {
    if (now.has(lineId)) continue;
    const entryId = entryOfLine(lineId);
    if (entryId) note(entryId, 'corrected', lastAppliedCorrectionAt(db, lineId));
  }
  const ranked = [...causes.entries()].sort((a, b) => b[1].at.localeCompare(a[1].at));
  const first = ranked[0];
  if (!first) return null;
  const [entryId, { change, at }] = first;
  const number = db.select({ number: financeEntries.number }).from(financeEntries).where(eq(financeEntries.id, entryId)).get()?.number ?? null;
  return { entryId, entryNumber: number, change, changedOn: at ? isoDayInZone(new Date(at), timeZone) : '', more: ranked.length - 1 };
}

function lastAppliedCorrectionAt(db: DbOrTx, lineId: string): string {
  return db.select({ approvedAt: financeAllocationCorrections.approvedAt }).from(financeAllocationCorrections).where(and(eq(financeAllocationCorrections.lineId, lineId), eq(financeAllocationCorrections.state, 'applied'))).orderBy(desc(financeAllocationCorrections.approvedAt)).get()?.approvedAt ?? '';
}

/**
 * Ohne Rechteprüfung: Voranmeldungen (begonnene Zeiträume) und Jahreserklärung eines Kalenderjahres, je mit Abgaben,
 * Berichtigung und ihrer Ursache (`timeZone` für deren Tag).
 */
export function vatPeriodViewsInternal(db: DbOrTx, calendarYear: number, today: string, timeZone: string = DEFAULT_TIME_ZONE): { advance: VatPeriodView[]; annual: VatPeriodView } {
  const advance = vatAdvancePeriodsInternal(db, calendarYear, today);
  const annual = annualStateInternal(db, calendarYear);
  const filings = filingsOf(db, [...advance.map((p) => p.key), annual.key]);
  const withFilings = (p: VatPeriodState): VatPeriodView => {
    const own = filings.get(p.key) ?? [];
    const amendmentDue = amendmentDueOf(db, p.key, own);
    return { ...p, filings: own.map((row) => vatFilingViewInternal(db, row)), amendmentDue, amendmentCause: amendmentDue ? vatAmendmentCauseInternal(db, p.key, timeZone) : null };
  };
  return { advance: advance.map(withFilings), annual: withFilings(annual) };
}

/**
 * Ohne Rechteprüfung: Ist für einen Zeitraum dieser Tage (Voranmeldung der Zeitraumart seines Jahres oder
 * Jahreserklärung) eine Berichtigung fällig — dieselbe Regel wie `amendmentDue` und die Frist `vatAmendment`
 * (Fingerabdruck der letzten Abgabe gegen heute, N8)? Mit `override` so, wie die Zeile nach einer beantragten Korrektur
 * stünde. Für den Hinweis `vatAmendment` an Buchen, Storno und Korrektur — eine Berichtigung, keine Sperre.
 */
export function vatAmendmentDueForDaysInternal(db: DbOrTx, days: readonly string[], override?: VatPartOverride): boolean {
  const keys = new Set<string>();
  for (const day of days) {
    keys.add(vatPeriodOf(day, vatAdvancePeriodKindInternal(db, Number(day.slice(0, 4)))).key);
    keys.add(day.slice(0, 4));
  }
  return [...filingsOf(db, [...keys]).entries()].some(([key, filings]) => lastFilingDiffers(db, key, filings.at(-1), override));
}

/** Eine abgegebene Umsatzsteuer-Erklärung in der Vorschau des Wiederöffnens (N14): Zeitraum, Art, Tag der letzten Abgabe. */
export interface VatFiledPeriod { period: string; kind: 'annual' | 'advance'; filedOn: string }

/**
 * Ohne Rechteprüfung: die abgegebenen Umsatzsteuer-Zeiträume, die die Tage `from` bis `to` berühren, je Zeitraum mit
 * der letzten Abgabe — Jahreserklärungen zuerst, dann die Voranmeldungen in der Folge der Zeiträume.
 */
export function vatFiledPeriodsInRangeInternal(db: DbOrTx, from: string, to: string): VatFiledPeriod[] {
  const latest = new Map<string, string>();
  for (const row of db.select({ period: financeVatFilings.period, filedOn: financeVatFilings.filedOn }).from(financeVatFilings).orderBy(asc(financeVatFilings.at), asc(financeVatFilings.id)).all()) {
    const range = parseVatPeriod(row.period);
    if (range && range.startsOn <= to && range.endsOn >= from) latest.set(row.period, row.filedOn);
  }
  const kindOf = (period: string): VatFiledPeriod['kind'] => (/^\d{4}$/.test(period) ? 'annual' : 'advance');
  return [...latest.entries()]
    .map(([period, filedOn]) => ({ period, kind: kindOf(period), filedOn }))
    .sort((a, b) => (a.kind === b.kind ? a.period.localeCompare(b.period) : a.kind === 'annual' ? -1 : 1));
}

const listSchema = z.object({ year: z.number().int().min(2000).max(2100) }).strict();

/** `finance.read`: Voranmeldungen und Jahreserklärung eines Kalenderjahres mit Pflicht, Frist, Beträgen, Abgaben und Berichtigung. */
export async function listVatPeriods(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ year: number; advance: VatPeriodView[]; annual: VatPeriodView }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  return ok({ year: parsed.value.year, ...vatPeriodViewsInternal(deps.db, parsed.value.year, todayIn(deps), timeZoneOf(deps)) });
}
