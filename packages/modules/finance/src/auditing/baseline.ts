import { isoNow, newId, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { financeAudit } from '../audit';
import { REPORT_CATALOG } from '../reporting/catalog';
import { canonicalJson, reportHash } from '../reporting/hash';
import { reportComputeEnvInternal } from '../reporting/service';
import type { ReportParams } from '../reporting/types';
import { financeAllocationLines, financeAuditBaselineEntries, financeAuditReports, financeAuditBaselines, financeEntries, financeEntryDocuments, financeFiscalYears, financeMoneyLines, type FinanceAuditBaselineRow } from '../schema';

/**
 * Der Prüfstand (Spec Rechenschaft 0.4.0 § D1 „Prüfstand“): beim Abschluss je Bericht des Prüfpakets Parameter und
 * Daten-Hash, je festgeschriebener Buchung ein Fingerabdruck. Die Seite rechnet live und vergleicht mit ihm:
 * „seit der Prüffassung vom … geändert: n Buchungen“ ist der Unterschied der Fingerabdrücke.
 */

/** Berichte, deren Hash der Prüfstand festhält: die für Mitgliederversammlung und Kassenprüfung. */
const BASELINE_GROUPS = ['assembly', 'audit'] as const;

export interface BaselineReportRef {
  key: string;
  params: ReportParams;
  hash: string;
}

/**
 * SHA-256 über die kanonische Form einer Buchung: Kopf ohne Zeitstempel, Geldzeilen (mit dem verknüpften Kontoumsatz), Zuordnungszeilen mit allen
 * Zuordnungen (mit Kennzeichen, Satz und Leistungstag wie der Fingerabdruck der Umsatzsteuer), nicht widerrufene Belegverknüpfungen (Nummer und Prüfsumme — die ID fällt nach der Frist weg) und der
 * Bezug zur Rücknahme. Gleiche Buchung, gleicher Fingerabdruck.
 */
export function entryFingerprintInternal(db: DbOrTx, entryId: string): string {
  const entry = db.select().from(financeEntries).where(eq(financeEntries.id, entryId)).get();
  if (!entry) throw new Error(`Buchung ${entryId} fehlt`);
  const money = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).orderBy(asc(financeMoneyLines.position), asc(financeMoneyLines.id)).all();
  const allocation = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).orderBy(asc(financeAllocationLines.position), asc(financeAllocationLines.id)).all();
  const vouchers = db
    .select({ documentNumber: financeEntryDocuments.documentNumber, documentChecksum: financeEntryDocuments.documentChecksum })
    .from(financeEntryDocuments)
    .where(and(eq(financeEntryDocuments.entryId, entryId), isNull(financeEntryDocuments.revokedAt)))
    .orderBy(asc(financeEntryDocuments.documentNumber))
    .all();
  const canonical = {
    head: { number: entry.number, entryDate: entry.entryDate, text: entry.text, status: entry.status, fiscalYearId: entry.fiscalYearId, correctionOfEntryId: entry.correctionOfEntryId },
    money: money.map((m) => ({ position: m.position, accountId: m.accountId, amountCents: m.amountCents, rawTransactionId: m.rawTransactionId })),
    allocation: allocation.map((a) => ({
      position: a.position, categoryId: a.categoryId, amountCents: a.amountCents, taxCode: a.taxCode, rateKind: a.rateKind, projectId: a.projectId, purposeId: a.purposeId,
      contactId: a.contactId, abroad: a.abroad, originLineId: a.originLineId, addsToAssets: a.addsToAssets,
      // N13: der Leistungstag wie im Fingerabdruck der Umsatzsteuer — nur mit Wert, damit Prüfstände ohne ihn gleich bleiben.
      ...(a.serviceDate ? { serviceDate: a.serviceDate } : {}),
    })),
    vouchers,
    reversal: { reversesEntryId: entry.reversesEntryId, reversedByEntryId: entry.reversedByEntryId },
  };
  return createHash('sha256').update(canonicalJson(canonical)).digest('hex');
}

function finalEntryIdsOfYear(db: DbOrTx, yearId: string): string[] {
  return db.select({ id: financeEntries.id }).from(financeEntries).where(and(eq(financeEntries.fiscalYearId, yearId), eq(financeEntries.status, 'final'))).orderBy(asc(financeEntries.id)).all().map((e) => e.id);
}

function reportRefsInternal(deps: Deps, db: DbOrTx, yearId: string): BaselineReportRef[] {
  const refs: BaselineReportRef[] = [];
  for (const def of REPORT_CATALOG) {
    if (!def.available || !(BASELINE_GROUPS as readonly string[]).includes(def.group)) continue;
    const params = def.paramsSchema.safeParse({ fiscalYearId: yearId });
    if (!params.success) continue;
    if (def.checkParams?.(db, params.data)) continue;
    refs.push({ key: def.key, params: params.data, hash: reportHash(def.key, params.data, def.compute(db, params.data, reportComputeEnvInternal(deps, def))).hash });
  }
  return refs;
}

/** Alle Prüfstände des Jahres, ältester zuerst. */
export function baselinesOfYearInternal(db: DbOrTx, yearId: string): FinanceAuditBaselineRow[] {
  return db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.fiscalYearId, yearId)).orderBy(asc(financeAuditBaselines.createdAt), asc(financeAuditBaselines.id)).all();
}

export function latestBaselineInternal(db: DbOrTx, yearId: string): FinanceAuditBaselineRow | null {
  return db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.fiscalYearId, yearId)).orderBy(desc(financeAuditBaselines.createdAt), desc(financeAuditBaselines.id)).get() ?? null;
}

export function baselineReportRefs(row: FinanceAuditBaselineRow): BaselineReportRef[] {
  return JSON.parse(row.reportRefs) as BaselineReportRef[];
}

/**
 * Einen Prüfstand anlegen — ohne Rechteprüfung, in der Transaktion des Aufrufers. `initial` nur, wenn das Jahr noch
 * keinen hat (sonst der vorhandene erste); `followUp` legt immer einen neuen an. Gibt die ID zurück.
 */
export function ensureBaselineInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, yearId: string, kind: 'initial' | 'followUp'): string {
  if (kind === 'initial') {
    const first = baselinesOfYearInternal(tx, yearId)[0];
    if (first) return first.id;
  }
  const id = newId();
  const now = isoNow(deps.clock);
  tx.insert(financeAuditBaselines).values({ id, fiscalYearId: yearId, kind, reportRefs: canonicalJson(reportRefsInternal(deps, tx, yearId)), createdAt: now }).run();
  const entryIds = finalEntryIdsOfYear(tx, yearId);
  for (const entryId of entryIds) tx.insert(financeAuditBaselineEntries).values({ baselineId: id, entryId, fingerprint: entryFingerprintInternal(tx, entryId) }).run();
  const designation = tx.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get()?.designation ?? '';
  financeAudit(tx, deps, ctx, { action: 'finance.audit.baseline.create', entity: 'financeAuditBaseline', id, after: { fiscalYearId: yearId, kind, entryCount: entryIds.length }, params: { designation, kind } });
  return id;
}

/**
 * Buchungen des Jahres, deren Fingerabdruck heute anders ist als im Prüfstand, und neue — eine zurückgenommene
 * Buchung ändert sich selbst (Bezug) und bringt ihre Rücknahme als neue mit. Sortiert nach ID.
 */
export function changedSinceInternal(db: DbOrTx, yearId: string, baselineId: string): string[] {
  const recorded = new Map(db.select().from(financeAuditBaselineEntries).where(eq(financeAuditBaselineEntries.baselineId, baselineId)).all().map((r) => [r.entryId, r.fingerprint]));
  const now = finalEntryIdsOfYear(db, yearId);
  const changed = now.filter((id) => recorded.get(id) !== entryFingerprintInternal(db, id));
  // Eine Buchung, die im Prüfstand stand und heute nicht mehr festgeschrieben im Jahr ist (das gibt es nicht — Festgeschriebenes bleibt), zählt trotzdem.
  for (const id of recorded.keys()) if (!now.includes(id)) changed.push(id);
  return [...new Set(changed)].sort();
}

/**
 * Buchungen, deren Fingerabdruck sich zwischen zwei Prüfständen unterscheidet oder die nur in einem stehen — aus den
 * gespeicherten Fingerabdrücken, ohne live zu rechnen.
 */
export function changedBetweenBaselinesInternal(db: DbOrTx, fromBaselineId: string, toBaselineId: string): Set<string> {
  const read = (id: string) => new Map(db.select().from(financeAuditBaselineEntries).where(eq(financeAuditBaselineEntries.baselineId, id)).all().map((r) => [r.entryId, r.fingerprint]));
  const from = read(fromBaselineId);
  const to = read(toBaselineId);
  const changed = new Set<string>();
  for (const [id, fp] of to) if (from.get(id) !== fp) changed.add(id);
  for (const id of from.keys()) if (!to.has(id)) changed.add(id);
  return changed;
}

/** Ist auf diesem Prüfstand ein Prüfbericht (oder Nachtrag) abgelegt? */
export function baselineFiledInternal(db: DbOrTx, baselineId: string): boolean {
  return Boolean(db.select({ id: financeAuditReports.id }).from(financeAuditReports).where(and(eq(financeAuditReports.baselineId, baselineId), eq(financeAuditReports.state, 'filed'))).get());
}

/** Der Prüfstand, gegen den „geändert“ zählt: der des zuletzt abgelegten Berichts, sonst der erste. `null` ohne Prüfstand. */
export function referenceBaselineInternal(db: DbOrTx, yearId: string): string | null {
  const all = baselinesOfYearInternal(db, yearId);
  const filed = all.filter((b) => baselineFiledInternal(db, b.id)).at(-1);
  return (filed ?? all[0])?.id ?? null;
}

/** Kurzform eines Prüfstands für das Papier: SHA-256 über Berichts-Hashes und Fingerabdrücke, acht Zeichen. */
export function baselineShortHashInternal(db: DbOrTx, baselineId: string): string {
  const row = db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.id, baselineId)).get();
  if (!row) return '';
  const entries = db.select().from(financeAuditBaselineEntries).where(eq(financeAuditBaselineEntries.baselineId, baselineId)).orderBy(asc(financeAuditBaselineEntries.entryId)).all().map((e) => [e.entryId, e.fingerprint]);
  return createHash('sha256').update(canonicalJson({ reportRefs: JSON.parse(row.reportRefs), entries })).digest('hex').slice(0, 8);
}
