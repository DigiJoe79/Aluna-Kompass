import { invalid, isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents, getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { reportDefinition } from './catalog';
import { finalVersionInternal, runReportInternal } from './service';
import { financeTaxAmendmentChecks, financeTaxAmendments, type FinanceTaxAmendmentCheckRow, type FinanceTaxAmendmentRow } from '../schema';
import { requireFinanceRead } from '../ledger/access';
import { taxFiguresJsonInternal, taxHistoryInternal, taxReviewStateInternal, type TaxHistoryEntry } from './tax-figures';
import { taxPeriodInternal, taxPeriodsInternal, updateTaxPeriodInternal, type TaxAmendmentCheckView, type TaxAmendmentView, type TaxPeriodRecordView, type TaxPeriodView } from '../ledger/tax-periods';

/**
 * B9 (Spec 0.5.2 § 4): Prüfanlass, Berichtigung und Prüfung der abgegebenen Steuererklärung (§ 153 AO). Die Dienste
 * liegen hier und nicht in `tax-periods.ts`, weil sie die Werte von heute aus den Berichten rechnen (`tax-figures.ts`),
 * die ihrerseits den Zeitraum lesen. Vorbild ist die Berichtigung der Umsatzsteuer (`vat-filings.ts`,
 * `reporting/vat-filing.ts`).
 */

function documentNumbers(db: DbOrTx, ids: readonly (string | null)[]): Map<string, string> {
  const known = ids.filter((id): id is string => id !== null);
  return new Map(known.length > 0 ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, known)).all().map((d) => [d.id, d.number ?? ''] as const) : []);
}

function amendmentViews(db: DbOrTx, history: readonly TaxHistoryEntry[]): TaxAmendmentView[] {
  const rows = history.filter((e): e is Extract<TaxHistoryEntry, { kind: 'amendment' }> => e.kind === 'amendment');
  const numbers = documentNumbers(db, rows.flatMap((e) => [e.row.filedReturnDocumentId, e.row.transmissionProtocolDocumentId]));
  return rows.map(({ row, cause }) => {
    const docs: TaxAmendmentView['documents'] = {};
    if (row.filedReturnDocumentId) docs.filedReturn = { documentId: row.filedReturnDocumentId, documentNumber: numbers.get(row.filedReturnDocumentId) ?? '' };
    if (row.transmissionProtocolDocumentId) docs.transmissionProtocol = { documentId: row.transmissionProtocolDocumentId, documentNumber: numbers.get(row.transmissionProtocolDocumentId) ?? '' };
    return { id: row.id, filedOn: row.filedOn, reportId: row.reportId, at: row.at, documents: docs, cause };
  });
}

function checkViews(db: DbOrTx, history: readonly TaxHistoryEntry[]): TaxAmendmentCheckView[] {
  const rows = history.filter((e): e is Extract<TaxHistoryEntry, { kind: 'check' | 'notice' }> => e.kind === 'check' || e.kind === 'notice');
  const numbers = documentNumbers(db, rows.map((e) => e.row.documentId));
  return rows.map((e) => ({
    id: e.row.id,
    kind: e.row.kind,
    checkedOn: e.row.checkedOn,
    byUserId: e.row.byUserId,
    reason: e.row.reason,
    document: e.row.documentId ? { documentId: e.row.documentId, documentNumber: numbers.get(e.row.documentId) ?? '' } : null,
    at: e.row.at,
    cause: e.kind === 'check' ? e.cause : [],
  }));
}

/** Ohne Rechteprüfung: der Zeitraum mit Prüfanlass, Berichtigungen und Prüfungen. */
export function withReviewInternal(deps: Deps, db: DbOrTx, base: TaxPeriodRecordView): TaxPeriodView {
  const state = taxReviewStateInternal(deps, db, base.id);
  return {
    ...base,
    reviewDue: state.reviewDue,
    reviewCause: state.cause,
    notifiedOn: state.notifiedOn,
    filedFiguresMissing: state.reference !== null && state.reference.figures === null,
    amendmentAllowed: state.amendmentAllowed,
    amendments: amendmentViews(db, state.history),
    checks: checkViews(db, state.history),
  };
}

/** Ohne Rechteprüfung: der Zeitraum mit Prüfanlass, oder `null`. */
export function taxPeriodViewInternal(deps: Deps, db: DbOrTx, id: string): TaxPeriodView | null {
  const base = taxPeriodInternal(db, id);
  return base ? withReviewInternal(deps, db, base) : null;
}

/** Ohne Rechteprüfung: alle Zeiträume mit Prüfanlass, neuester zuerst. */
export function taxPeriodViewsInternal(deps: Deps, db: DbOrTx): TaxPeriodView[] {
  return taxPeriodsInternal(db).map((p) => withReviewInternal(deps, db, p));
}

/** `finance.read`: alle Erklärungszeiträume, neuester zuerst, je mit Prüfanlass, Berichtigungen und Prüfungen. */
export async function listTaxPeriods(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  return ok(taxPeriodViewsInternal(deps, deps.db));
}

/**
 * `finance.periodClose`: Jahre, Aufforderung, Beratung, Frist und die erste Abgabe ändern (`updateTaxPeriodInternal`).
 * Die erste Abgabe hält das Abbild der Werte fest — den Maßstab des Prüfanlasses (B9).
 */
export async function updateTaxPeriod(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxPeriodView>> {
  const updated = await updateTaxPeriodInternal(deps, ctx, input, (tx, id) => taxFiguresJsonInternal(deps, tx, id));
  if (!updated.ok) return updated;
  return ok(withReviewInternal(deps, deps.db, updated.value));
}

// ── Berichtigung ───────────────────────────────────────────────────────────

/** Ohne Rechteprüfung: die nicht stornierte festgeschriebene Fassung von `taxReturnGem` mit den Daten von heute, sonst `null`. */
export function finalTaxReturnReportInternal(deps: Deps, db: DbOrTx, taxPeriodId: string): string | null {
  const def = reportDefinition('taxReturnGem')!;
  const params = { taxPeriodId };
  if (def.checkParams?.(db, params)) return null;
  const run = runReportInternal(deps, db, def, params);
  return finalVersionInternal(db, def.key, params, run.hash)?.reportId ?? null;
}

function amendmentViewInternal(db: DbOrTx, taxPeriodId: string, id: string): TaxAmendmentView {
  return amendmentViews(db, taxHistoryInternal(db, taxPeriodId)).find((a) => a.id === id)!;
}

const recordSchema = z.object({ taxPeriodId: z.string().min(1), filedOn: z.iso.date() }).strict();

/**
 * `finance.periodClose`: die berichtigte Steuererklärung als zweite Abgabe eintragen (Spec 0.5.2 § 4.3) — eine
 * Tatsache, kein `humanOnly`. Nur, solange die Werte heute von der letzten Abgabe abweichen oder sie kein Abbild hat
 * (`taxAmendmentNotDue`, N24); der Tag nicht in der Zukunft und nicht vor der letzten Abgabe; mit einer
 * festgeschriebenen Fassung von `taxReturnGem` mit den Daten von heute (`taxReturnNotFinal`). Hält Abbild und Fassung
 * fest; der erste Tag am Zeitraum bleibt. Das Protokoll nennt Zeitraum und Tag, nie das Abbild.
 */
export async function recordTaxAmendment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxAmendmentView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, recordSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const period = taxPeriodInternal(deps.db, v.taxPeriodId);
  if (!period) return notFound('financeTaxPeriod', v.taxPeriodId);
  if (!period.filedOn) return financeConflict('taxPeriodNotFiled', { period: period.label });
  const state = taxReviewStateInternal(deps, deps.db, period.id);
  if (!state.amendmentAllowed) return financeConflict('taxAmendmentNotDue', { period: period.label, filedOn: state.lastFiledOn ?? period.filedOn });
  if (v.filedOn > todayIn(deps)) return invalid([{ path: 'filedOn', message: 'inFuture' }]);
  if (state.lastFiledOn && v.filedOn < state.lastFiledOn) return invalid([{ path: 'filedOn', message: 'beforeLastFiling', params: { lastFiledOn: state.lastFiledOn } }]);
  const reportId = finalTaxReturnReportInternal(deps, deps.db, period.id);
  if (!reportId) return financeConflict('taxReturnNotFinal', { period: period.label });
  return deps.db.transaction((tx: DbOrTx) => {
    const row: FinanceTaxAmendmentRow = {
      id: newId(),
      taxPeriodId: period.id,
      filedOn: v.filedOn,
      figures: taxFiguresJsonInternal(deps, tx, period.id)!,
      reportId,
      filedReturnDocumentId: null,
      transmissionProtocolDocumentId: null,
      at: isoNow(deps.clock),
      byUserId: ctx.userId ?? 'system',
    };
    tx.insert(financeTaxAmendments).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.taxAmendment.record', entity: 'financeTaxAmendment', id: row.id, after: { filedOn: row.filedOn }, params: { period: period.label, filedOn: row.filedOn } });
    return ok(amendmentViewInternal(tx, period.id, row.id));
  });
}

const updateSchema = z.object({ amendmentId: z.string().min(1), filedOn: z.iso.date() }).strict();

/** `finance.periodClose`: den Tag der letzten Berichtigung ändern (`taxAmendmentNotLatest` sonst), Regeln wie beim Eintragen. Zurücknehmen geht nicht. */
export async function updateTaxAmendment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxAmendmentView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = deps.db.select().from(financeTaxAmendments).where(eq(financeTaxAmendments.id, v.amendmentId)).get();
  if (!row) return notFound('financeTaxAmendment', v.amendmentId);
  const period = taxPeriodInternal(deps.db, row.taxPeriodId)!;
  const filings = taxHistoryInternal(deps.db, period.id).filter((e) => e.kind === 'filing' || e.kind === 'amendment');
  const latest = filings.at(-1);
  if (latest?.kind !== 'amendment' || latest.row.id !== row.id) return financeConflict('taxAmendmentNotLatest', { period: period.label });
  const previous = filings.at(-2)!.day;
  if (v.filedOn > todayIn(deps)) return invalid([{ path: 'filedOn', message: 'inFuture' }]);
  if (v.filedOn < previous) return invalid([{ path: 'filedOn', message: 'beforeLastFiling', params: { lastFiledOn: previous } }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeTaxAmendments).set({ filedOn: v.filedOn }).where(eq(financeTaxAmendments.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.taxAmendment.update', entity: 'financeTaxAmendment', id: row.id, before: { filedOn: row.filedOn }, after: { filedOn: v.filedOn }, params: { period: period.label, filedOn: v.filedOn } });
    return ok(amendmentViewInternal(tx, period.id, row.id));
  });
}

// ── Prüfung ────────────────────────────────────────────────────────────────

function checkViewInternal(db: DbOrTx, taxPeriodId: string, id: string): TaxAmendmentCheckView {
  return checkViews(db, taxHistoryInternal(db, taxPeriodId)).find((c) => c.id === id)!;
}

const closeSchema = z.object({ taxPeriodId: z.string().min(1), reason: z.string().trim().min(1).max(2000), documentId: z.string().min(1).optional() }).strict();

/**
 * `finance.periodClose`, nur durch einen Menschen (`finance.mcpHumanOnlyAllowed`, Vereinsrecht K2): den offenen
 * Prüfanlass ohne Berichtigung schließen — „geprüft, keine Verkürzung möglich“ (Spec 0.5.2 § 4.3, F2). Nur bei offenem
 * Anlass (`taxAmendmentCheckNotOpen`). Hält Tag (heute), Person, Begründung, optional einen Beleg aus der Akte
 * (ausgestellt, nicht storniert) und das Abbild als neuen Maßstab fest. Die Begründung steht nie im Protokoll.
 */
export async function closeTaxAmendmentReview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxAmendmentCheckView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, closeSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const period = taxPeriodInternal(deps.db, v.taxPeriodId);
  if (!period) return notFound('financeTaxPeriod', v.taxPeriodId);
  if (!taxReviewStateInternal(deps, deps.db, period.id).reviewDue) return financeConflict('taxAmendmentCheckNotOpen', { period: period.label });
  if (v.documentId) {
    const doc = await getDocumentRecord(deps, ctx, v.documentId);
    if (!doc.ok) return doc;
    if (doc.value.status === 'voided') return invalid([{ path: 'documentId', message: 'documentVoided' }]);
    if (doc.value.phase !== 'issued') return invalid([{ path: 'documentId', message: 'documentNotFinal' }]);
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const row: FinanceTaxAmendmentCheckRow = {
      id: newId(),
      taxPeriodId: period.id,
      kind: 'noAmendment',
      checkedOn: todayIn(deps),
      figures: taxFiguresJsonInternal(deps, tx, period.id)!,
      reason: v.reason,
      documentId: v.documentId ?? null,
      at: isoNow(deps.clock),
      byUserId: ctx.userId ?? 'system',
    };
    tx.insert(financeTaxAmendmentChecks).values(row).run();
    if (row.documentId) {
      linkDocumentInternal(tx, deps, { documentId: row.documentId, entityType: 'financeTaxAmendmentCheck', entityId: row.id });
      linkDocumentInternal(tx, deps, { documentId: row.documentId, entityType: 'financeTaxPeriod', entityId: period.id });
    }
    const withDocument = row.documentId !== null;
    financeAudit(tx, deps, ctx, { action: 'finance.taxAmendment.closeWithoutAmendment', entity: 'financeTaxAmendmentCheck', id: row.id, after: { kind: row.kind, checkedOn: row.checkedOn, withDocument }, params: { period: period.label, checkedOn: row.checkedOn, withDocument } });
    return ok(checkViewInternal(tx, period.id, row.id));
  });
}

const noticeSchema = z.object({ taxPeriodId: z.string().min(1), notifiedOn: z.iso.date() }).strict();

/**
 * `finance.periodClose`: den Tag der Anzeige an das Finanzamt zum offenen Prüfanlass eintragen (Spec 0.5.2 § 4.3, F6) —
 * eine Tatsache, kein `humanOnly`. Nur bei offenem Anlass (`taxAmendmentCheckNotOpen`); nicht in der Zukunft. Ist zum
 * laufenden Anlass schon eine Anzeige eingetragen, ändert sich ihr Tag. Kein Abbild, schließt nichts; das Schreiben legt
 * `fileTaxPeriodDocument` mit `target: 'notice'` ab.
 */
export async function recordTaxAmendmentNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxAmendmentCheckView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, noticeSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const period = taxPeriodInternal(deps.db, v.taxPeriodId);
  if (!period) return notFound('financeTaxPeriod', v.taxPeriodId);
  const state = taxReviewStateInternal(deps, deps.db, period.id);
  if (!state.reviewDue) return financeConflict('taxAmendmentCheckNotOpen', { period: period.label });
  if (v.notifiedOn > todayIn(deps)) return invalid([{ path: 'notifiedOn', message: 'inFuture' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const known = state.notice;
    let id: string;
    if (known) {
      id = known.id;
      tx.update(financeTaxAmendmentChecks).set({ checkedOn: v.notifiedOn }).where(eq(financeTaxAmendmentChecks.id, id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.taxAmendment.notified', entity: 'financeTaxAmendmentCheck', id, before: { checkedOn: known.checkedOn }, after: { checkedOn: v.notifiedOn }, params: { period: period.label, checkedOn: v.notifiedOn } });
    } else {
      const row: FinanceTaxAmendmentCheckRow = { id: newId(), taxPeriodId: period.id, kind: 'notified', checkedOn: v.notifiedOn, figures: null, reason: null, documentId: null, at: isoNow(deps.clock), byUserId: ctx.userId ?? 'system' };
      id = row.id;
      tx.insert(financeTaxAmendmentChecks).values(row).run();
      financeAudit(tx, deps, ctx, { action: 'finance.taxAmendment.notified', entity: 'financeTaxAmendmentCheck', id, after: { kind: row.kind, checkedOn: row.checkedOn }, params: { period: period.label, checkedOn: row.checkedOn } });
    }
    return ok(checkViewInternal(tx, period.id, id));
  });
}
