import { invalid, isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { listVatPeriods, vatFilingsOfInternal, vatFurtherFilingAllowedInternal, vatFilingViewInternal, VAT_FILING_DOCUMENT_SLOTS, type VatFilingDocumentSlot, type VatFilingView, type VatPeriodView } from '../ledger/vat-filings';
import { vatFilingOpensOn } from '../ledger/vat-calendar';
import { parseVatPeriod, vatAdvancePeriodsInternal, vatDigestOfParts, vatPeriodPartsInternal, vatReturnRequiredInternal } from '../ledger/vat-periods';
import { financeFiscalYears, financeReports, financeVatFilings, type FinanceVatFilingRow } from '../schema';
import { canonicalJson } from './hash';
import { reportDefinition } from './catalog';
import { vatFigureValuesInternal, vatFiguresOfPeriodInternal } from '../ledger/vat-figures';
import { runReportInternal } from './service';

/**
 * Abgabe je Umsatzsteuer-Zeitraum (Spec E6 Teil 4/5, Plan E6a Task 5, E6b Task 6): Voranmeldung (`'YYYY-Qn'`,
 * `'YYYY-MM'`) und Jahreserklärung (`'YYYY'`). Seit E6b in `reporting/`, weil die Abgabe die Kennzahlen des Berichts als
 * Abbild festhält und die festgeschriebene Fassung mit dem Datenstand der Abgabe verknüpft (Joe 2026-10-25, Frage 1: die
 * Abgabe ist auch ohne Fassung möglich; eine spätere Fassung mit gleichem Datenstand wird beim Festschreiben verknüpft).
 * Die Sichten (`listVatPeriods`, Berichtigung) bleiben in `ledger/vat-filings.ts`.
 */

/** Die Parameter des Berichts zur Abgabe: Voranmeldung `{ vatPeriod }`, Jahr `vatSummary` des Geschäftsjahres mit dem 31.12. */
function reportOfPeriod(db: DbOrTx, period: string): { key: string; params: Record<string, string> } | null {
  const range = parseVatPeriod(period);
  if (!range) return null;
  if (range.kind !== 'year') return { key: 'vatAdvanceReturn', params: { vatPeriod: range.key } };
  const covering = db.select({ id: financeFiscalYears.id, startsOn: financeFiscalYears.startsOn, endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).all().find((y) => y.startsOn <= range.endsOn && y.endsOn >= range.endsOn) ?? null;
  return covering ? { key: 'vatSummary', params: { fiscalYearId: covering.id } } : null;
}

/** Ohne Rechteprüfung: die nicht stornierte festgeschriebene Fassung zum Zeitraum mit dem heutigen Datenstand, sonst `null`. */
export function finalizedVatReportInternal(deps: Deps, db: DbOrTx, period: string): string | null {
  const report = reportOfPeriod(db, period);
  const def = report ? reportDefinition(report.key) : null;
  if (!report || !def) return null;
  if (def.checkParams?.(db, report.params)) return null;
  const run = runReportInternal(deps, db, def, report.params);
  return (
    db
      .select({ id: financeReports.id })
      .from(financeReports)
      .where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, canonicalJson(report.params)), eq(financeReports.dataHash, run.hash), isNull(financeReports.voidedAt)))
      .get()?.id ?? null
  );
}


/**
 * In der Transaktion des Festschreibens: eine Abgabe des Zeitraums ohne Fassung, deren Zeilen sich seitdem nicht
 * geändert haben (gleicher Fingerabdruck), bekommt die neue Fassung — die letzte zuerst (Joe, Frage 1).
 */
export function linkVatFilingReportInternal(tx: DbOrTx, reportKey: string, params: Record<string, unknown>, reportId: string): void {
  const period = reportKey === 'vatAdvanceReturn' ? (params.vatPeriod as string | undefined) : undefined;
  if (!period) return;
  const last = tx.select().from(financeVatFilings).where(eq(financeVatFilings.period, period)).orderBy(desc(financeVatFilings.at), desc(financeVatFilings.id)).get();
  if (!last || last.reportId !== null || last.linesDigest !== vatDigestOfParts(vatPeriodPartsInternal(tx, period))) return;
  tx.update(financeVatFilings).set({ reportId }).where(eq(financeVatFilings.id, last.id)).run();
}

const recordSchema = z.object({ period: z.string().min(1), filedOn: z.iso.date() }).strict();

/**
 * `finance.periodClose`: die Abgabe einer Voranmeldung oder Jahreserklärung eintragen — eine Tatsache, keine persönliche
 * Erklärung (kein `humanOnly`). Die Voranmeldung nur für einen Zeitraum der Zeitraumart des Jahres mit Pflicht
 * (`vatAdvanceReturnNotDue`), die Jahreserklärung nur mit Pflicht (`vatReturnNotDue`); ist der Zeitraum schon abgegeben,
 * gilt das nicht — dann ist es die berichtigte Anmeldung (`amendment`), und die nur bei fälliger Berichtigung
 * (`vatAmendmentNotDue`, N6). `filedOn` nach dem Zeitraumende und nicht in der
 * Zukunft. Hält Fingerabdruck und Abbild der Zeilen, die Kennzahlen (`figures`) und die festgeschriebene Fassung mit dem
 * heutigen Datenstand (`reportId`, sonst `null`) fest.
 */
export async function recordVatFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatFilingView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, recordSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const range = parseVatPeriod(v.period);
  if (!range) return invalid([{ path: 'period', message: 'invalid' }]);
  const today = todayIn(deps);
  const year = Number(range.key.slice(0, 4));
  const earlier = vatFilingsOfInternal(deps.db, range.key);
  if (earlier.length === 0) {
    if (range.kind === 'year') {
      if (!vatReturnRequiredInternal(deps.db, year)) return financeConflict('vatReturnNotDue', { period: range.key });
    } else {
      const state = vatAdvancePeriodsInternal(deps.db, year, today).find((p) => p.key === range.key);
      if (!state?.required) return financeConflict('vatAdvanceReturnNotDue', { period: range.key });
    }
  }
  if (v.filedOn > today) return invalid([{ path: 'filedOn', message: 'inFuture' }]);
  const opensOn = vatFilingOpensOn(range.key)!;
  // N7/N26: den Tag, ab dem die Abgabe geht, nennt die Ablehnung mit.
  if (v.filedOn < opensOn) return invalid([{ path: 'filedOn', message: 'beforePeriodEnd', params: { opensOn } }]);
  // N6 (Joe 2026-10-27): Eine weitere Abgabe ist die Berichtigung und nur bei fälliger Berichtigung möglich — ein
  // Doppelklick oder ein wiederholender Agent legt keine an. Den Tag der letzten Abgabe ändert `updateVatFiling`.
  const last = earlier.at(-1);
  if (last && !vatFurtherFilingAllowedInternal(deps.db, range.key, earlier)) return financeConflict('vatAmendmentNotDue', { vatPeriod: range.key, filedOn: last.filedOn });
  return deps.db.transaction((tx: DbOrTx) => {
    const parts = vatPeriodPartsInternal(tx, range.key);
    const row: FinanceVatFilingRow = {
      id: newId(),
      period: range.key,
      filedOn: v.filedOn,
      amendment: earlier.length > 0,
      linesDigest: vatDigestOfParts(parts),
      linesSnapshot: JSON.stringify(parts),
      // N6: Kz 10 = 1 an der Berichtigung, damit die festgehaltenen Werte der Marke `amendment` nicht widersprechen.
      figures: JSON.stringify({ ...vatFiguresOfPeriodInternal(tx, range.key), amended: earlier.length > 0 ? 1 : 0 }),
      reportId: finalizedVatReportInternal(deps, tx, range.key),
      filedReturnDocumentId: null,
      transmissionProtocolDocumentId: null,
      at: isoNow(deps.clock),
      byUserId: ctx.userId ?? 'system',
    };
    tx.insert(financeVatFilings).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.vatFiling.record', entity: 'financeVatFiling', id: row.id, after: { period: row.period, filedOn: row.filedOn, amendment: row.amendment }, params: { period: row.period, filedOn: row.filedOn, amendment: row.amendment } });
    return ok(vatFilingViewInternal(tx, row));
  });
}

const loadFiling = (db: DbOrTx, id: string) => db.select().from(financeVatFilings).where(eq(financeVatFilings.id, id)).get() ?? null;
const isLatest = (db: DbOrTx, row: FinanceVatFilingRow) => vatFilingsOfInternal(db, row.period).at(-1)?.id === row.id;

const updateSchema = z.object({ filingId: z.string().min(1), filedOn: z.iso.date() }).strict();

/** `finance.periodClose`: den Tag der letzten Abgabe eines Zeitraums ändern (`vatFilingNotLatest` sonst), Regeln wie beim Eintragen. */
export async function updateVatFiling(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatFilingView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadFiling(deps.db, v.filingId);
  if (!row) return notFound('financeVatFiling', v.filingId);
  if (!isLatest(deps.db, row)) return financeConflict('vatFilingNotLatest', { vatPeriod: row.period });
  const range = parseVatPeriod(row.period)!;
  if (v.filedOn > todayIn(deps)) return invalid([{ path: 'filedOn', message: 'inFuture' }]);
  const opensOn = vatFilingOpensOn(range.key)!;
  // N7/N26: den Tag, ab dem die Abgabe geht, nennt die Ablehnung mit.
  if (v.filedOn < opensOn) return invalid([{ path: 'filedOn', message: 'beforePeriodEnd', params: { opensOn } }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeVatFilings).set({ filedOn: v.filedOn }).where(eq(financeVatFilings.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.vatFiling.update', entity: 'financeVatFiling', id: row.id, before: { filedOn: row.filedOn }, after: { filedOn: v.filedOn }, params: { period: row.period, filedOn: v.filedOn } });
    return ok(vatFilingViewInternal(tx, loadFiling(tx, row.id)!));
  });
}

// ── Ablage ─────────────────────────────────────────────────────────────────

/** Die Art der Dokumente an einer Abgabe (`install.ts`). */
export const VAT_RETURN_DOCUMENT_TYPE = 'finance-vat-return';
const SLOT_COLUMN = { filedReturn: 'filedReturnDocumentId', transmissionProtocol: 'transmissionProtocolDocumentId' } as const satisfies Record<VatFilingDocumentSlot, keyof FinanceVatFilingRow>;
/** Betreff in der Akte — Papiertext (deutsch, Prinzip 7), nennt keine Person. */
const SLOT_SUBJECT: Record<VatFilingDocumentSlot, string> = { filedReturn: 'Abgegebene Fassung', transmissionProtocol: 'ELSTER-Übertragungsprotokoll' };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** „Umsatzsteuer-Voranmeldung 2. Quartal 2026“ bzw. „Umsatzsteuer-Jahreserklärung 2026“. */
function periodSubject(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `Umsatzsteuer-Voranmeldung ${q[2]}. Quartal ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `Umsatzsteuer-Voranmeldung ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return `Umsatzsteuer-Jahreserklärung ${period}`;
}

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const isPdf = (bytes: Uint8Array): boolean => bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
const fileSchema = z.object({ filingId: z.string().min(1), slot: z.enum(VAT_FILING_DOCUMENT_SLOTS), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional() });
const linkSchema = z.object({ filingId: z.string().min(1), slot: z.enum(VAT_FILING_DOCUMENT_SLOTS), documentId: z.string().min(1) });

/** In der Transaktion: Fach setzen, Bezug auf die Abgabe, Protokoll (Zeitraum und Fach, keine Person). */
function setSlotInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: FinanceVatFilingRow, slot: VatFilingDocumentSlot, documentId: string, action: 'finance.vatFiling.documentFile' | 'finance.vatFiling.documentLink'): VatFilingView {
  tx.update(financeVatFilings).set({ [SLOT_COLUMN[slot]]: documentId }).where(eq(financeVatFilings.id, row.id)).run();
  linkDocumentInternal(tx, deps, { documentId, entityType: 'financeVatFiling', entityId: row.id });
  financeAudit(tx, deps, ctx, { action, entity: 'financeVatFiling', id: row.id, params: { period: row.period, slot } });
  return vatFilingViewInternal(tx, loadFiling(tx, row.id)!);
}

/** Die abgegebene Fassung nur zu einer festgeschriebenen (Joe, Frage 1: „nach dem Festschreiben“), das Protokoll immer. */
function slotRefusal(row: FinanceVatFilingRow, slot: VatFilingDocumentSlot) {
  return slot === 'filedReturn' && row.reportId === null ? financeConflict('vatFilingNotFinalized', { vatPeriod: row.period }) : null;
}

/** `finance.periodClose`: ein PDF (bis 10 MB) als Art `finance-vat-return` an der Abgabe ablegen und in das Fach setzen. */
export async function fileVatFilingDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatFilingView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > DOCUMENT_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const row = loadFiling(deps.db, v.filingId);
  if (!row) return notFound('financeVatFiling', v.filingId);
  const refused = slotRefusal(row, v.slot);
  if (refused) return refused;
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: VAT_RETURN_DOCUMENT_TYPE,
    subject: `${periodSubject(row.period)}, ${SLOT_SUBJECT[v.slot]}`,
    documentDate: todayIn(deps),
    links: [{ entityType: 'financeVatFiling', entityId: row.id }],
    afterReceive: (tx, doc) => setSlotInternal(tx, deps, ctx, loadFiling(tx, row.id)!, v.slot, doc.id, 'finance.vatFiling.documentFile'),
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}

/** `finance.periodClose`: ein Dokument aus der Akte (ausgestellt, nicht storniert) in ein Fach der Abgabe setzen. */
export async function linkVatFilingDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatFilingView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadFiling(deps.db, v.filingId);
  if (!row) return notFound('financeVatFiling', v.filingId);
  const refused = slotRefusal(row, v.slot);
  if (refused) return refused;
  const doc = await getDocumentRecord(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  if (doc.value.status === 'voided') return invalid([{ path: 'documentId', message: 'documentVoided' }]);
  if (doc.value.phase !== 'issued') return invalid([{ path: 'documentId', message: 'documentNotFinal' }]);
  return deps.db.transaction((tx: DbOrTx) => ok(setSlotInternal(tx, deps, ctx, loadFiling(tx, row.id)!, v.slot, doc.value.id, 'finance.vatFiling.documentLink')));
}

/**
 * Was eine offene Berichtigung kostet (Designer Runde 8, 345): Kz 83 (bzw. 816) berichtigt, abzüglich der zuletzt
 * abgegebenen, die schon gezahlt ist. `first`: Die letzte Abgabe ist die erste Fassung des Zeitraums. Die Kennzahlen
 * rechnet `ledger/vat-figures.ts`.
 */
export interface VatAmendmentPayment { amendedCents: number; filedCents: number; payableCents: number; filedOn: string; first: boolean }
export type VatPeriodWithPayment = VatPeriodView & { amendmentPayment: VatAmendmentPayment | null };

/** Ohne Rechteprüfung: die Nachzahlung einer offenen Berichtigung; ohne Berichtigung oder ohne Abbild der letzten Abgabe `null`. */
export function vatAmendmentPaymentInternal(db: DbOrTx, period: VatPeriodView): VatAmendmentPayment | null {
  const last = period.filings.at(-1);
  if (!period.amendmentDue || !last?.figures) return null;
  const filedCents = last.figures.result ?? 0;
  const amendedCents = vatFigureValuesInternal(db, { from: period.startsOn, to: period.endsOn }).find((v) => v.source === 'result')?.cents ?? 0;
  return { amendedCents, filedCents, payableCents: amendedCents - filedCents, filedOn: last.filedOn, first: period.filings.length === 1 };
}

/** `finance.read`: `listVatPeriods` und je Zeitraum mit offener Berichtigung die Nachzahlung — Seite und Agent lesen dasselbe. */
export async function listVatPeriodsWithPayments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ year: number; advance: VatPeriodWithPayment[]; annual: VatPeriodWithPayment }>> {
  const listed = await listVatPeriods(deps, ctx, input);
  if (!listed.ok) return listed;
  const withPayment = (p: VatPeriodView): VatPeriodWithPayment => ({ ...p, amendmentPayment: vatAmendmentPaymentInternal(deps.db, p) });
  return ok({ year: listed.value.year, advance: listed.value.advance.map(withPayment), annual: withPayment(listed.value.annual) });
}
