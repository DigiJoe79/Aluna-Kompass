import { forbidden, hasPermission, notFound, requirePermission, type CallContext, type DbOrTx, type Deps, type Failure } from '@kompass/core';
import { financeConflict } from '../errors';
import { FINANCE_PERMISSIONS } from '../permissions';
import { contactIdForUserInternal } from '@kompass/module-contacts';
import { and, desc, eq, gt } from 'drizzle-orm';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { carryOverClosesFollowUpInternal } from './carry-over';
import { financeAuditAuditors, financeAuditBaselines, financeAuditRemarks, financeAuditReportDeviations, financeAuditReportResults, financeAuditReports, financeAuditReportScans, financeAuditSamples, financeAuditSectionReviews, financeCashCountWitnesses, financeFiscalYears, financePeriodEvents, type FinanceAuditAuditorRow, type FinanceFiscalYearRow } from '../schema';

/**
 * Wer in der Kassenprüfung was darf (Spec § D1, Plan D1a Global Constraints „Rechte“). Ohne Rechteprüfung des
 * Aufrufers, ohne `(deps, ctx)`-Signatur — Innenleben der Dienste, nicht über `index.ts` exportiert.
 */

/** Finanzrechte, die schreiben (alle außer lesen und prüfen): Wer eines trägt, schreibt nie den Prüfbericht (wie der berechnete Prüferzugang, § 9.4). */
export const FINANCE_WRITE_PERMISSIONS: readonly string[] = FINANCE_PERMISSIONS.filter((p) => !['finance.read', 'finance.overview', 'finance.audit'].includes(p));

/** Lesen in der Kassenprüfung: `finance.read` oder `finance.audit`. */
export function requireAuditRead(ctx: CallContext): Failure | null {
  if (hasPermission(ctx, 'finance.read') || hasPermission(ctx, 'finance.audit')) return null;
  return forbidden('finance.read');
}

/** Der Eintrag „prüft in Kompass“ des Nutzers für das Jahr, über die Nutzer-Kontakt-Verknüpfung — oder `null`. */
export function auditorOfInternal(db: DbOrTx, userId: string | null | undefined, fiscalYearId: string): FinanceAuditAuditorRow | null {
  if (!userId) return null;
  const contactId = contactIdForUserInternal(db, userId);
  if (!contactId) return null;
  return db.select().from(financeAuditAuditors).where(and(eq(financeAuditAuditors.fiscalYearId, fiscalYearId), eq(financeAuditAuditors.contactId, contactId), eq(financeAuditAuditors.mode, 'kompass'))).get() ?? null;
}

/**
 * Bearbeiter des Prüfberichts (Spec § D1): `finance.audit`, für das Jahr als „prüft in Kompass“ eingetragen und kein
 * Schreibrecht in den Finanzen — so schreibt der Schatzmeister nie den eigenen Prüfbericht.
 */
export function isReportEditorInternal(db: DbOrTx, ctx: CallContext, fiscalYearId: string): boolean {
  if (!hasPermission(ctx, 'finance.audit')) return false;
  if (FINANCE_WRITE_PERMISSIONS.some((p) => hasPermission(ctx, p))) return false;
  return auditorOfInternal(db, ctx.userId, fiscalYearId) !== null;
}

/**
 * Warum jemand mit `finance.audit` den Prüfbericht nicht bearbeitet: Er schreibt in den Finanzen
 * (`auditorHasWriteRights`), oder er ist für das Jahr nicht als „prüft in Kompass“ eingetragen (`auditorRequired`).
 */
export function reportEditorRefusalInternal(db: DbOrTx, ctx: CallContext, fiscalYearId: string): 'auditorHasWriteRights' | 'auditorRequired' | null {
  if (FINANCE_WRITE_PERMISSIONS.some((p) => hasPermission(ctx, p))) return 'auditorHasWriteRights';
  if (!hasPermission(ctx, 'finance.audit') || auditorOfInternal(db, ctx.userId, fiscalYearId) === null) return 'auditorRequired';
  return null;
}

/** Die Prüfer eines Jahres, in der Reihenfolge des Eintragens. */
export function auditorsOfYearInternal(db: DbOrTx, fiscalYearId: string): FinanceAuditAuditorRow[] {
  return db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.fiscalYearId, fiscalYearId)).orderBy(financeAuditAuditors.createdAt, financeAuditAuditors.id).all();
}

/**
 * Die Kassenprüfung, die gerade läuft: das jüngste abgeschlossene Jahr mit Prüfern, dessen Prüfung nicht
 * abgeschlossen ist. `null`, wenn keine läuft.
 */
export function currentAuditYearInternal(db: DbOrTx): string | null {
  const years = db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).orderBy(desc(financeFiscalYears.endsOn)).all();
  for (const year of years) {
    if (fiscalYearStatusInternal(db, year.id) !== 'closed') continue;
    if (auditorsOfYearInternal(db, year.id).length === 0) continue;
    return auditDoneInternal(db, year.id) ? null : year.id;
  }
  return null;
}

/**
 * Ist die Kassenprüfung des Jahres abgeschlossen? Ein Bericht ist abgelegt, danach wurde das Jahr nicht wieder
 * geöffnet, und er liegt auf dem jüngsten Prüfstand (sonst ist die Nachprüfung offen; wie `followUpOpenInternal`).
 */
export function auditDoneInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const filed = db.select().from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt), desc(financeAuditReports.id)).get();
  if (!filed?.filedAt) return false;
  const reopened = db.select({ id: financePeriodEvents.id }).from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, fiscalYearId), eq(financePeriodEvents.kind, 'reopened'), gt(financePeriodEvents.at, filed.filedAt))).get();
  const latest = db.select({ id: financeAuditBaselines.id }).from(financeAuditBaselines).where(eq(financeAuditBaselines.fiscalYearId, fiscalYearId)).orderBy(desc(financeAuditBaselines.createdAt), desc(financeAuditBaselines.id)).get();
  return (!reopened && latest?.id === filed.baselineId) || carryOverClosesFollowUpInternal(db, fiscalYearId);
}

/**
 * Seit wann Stichproben und Durchsicht feststehen: der Tag der Ablage des Prüfberichts, solange die Prüfung
 * abgeschlossen ist (`auditDoneInternal`); sonst `null` — auch nach einem Wiederöffnen (Nachprüfung). Eine Quelle für
 * die Dienste und die Oberfläche (Designer Runde 7, 274/279).
 */
export function auditWorkFixedSinceInternal(db: DbOrTx, fiscalYearId: string): string | null {
  if (!auditDoneInternal(db, fiscalYearId)) return null;
  const filed = db.select({ filedAt: financeAuditReports.filedAt }).from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt), desc(financeAuditReports.id)).get();
  return filed?.filedAt ?? null;
}

/**
 * Hängt Arbeit am Eintrag — Vermerke, Stichproben, durchgesehene Abschnitte, Beiträge zum Prüfbericht? Dann bleibt er
 * (`removeAuditor` lehnt ab). Jede Tabelle der Kassenprüfung, die einen Prüfer nennt, steht hier.
 */
export function auditorWorkInternal(db: DbOrTx, auditorId: string): boolean {
  if (db.select({ id: financeAuditSamples.id }).from(financeAuditSamples).where(eq(financeAuditSamples.auditorId, auditorId)).get()) return true;
  if (db.select({ at: financeAuditSectionReviews.at }).from(financeAuditSectionReviews).where(eq(financeAuditSectionReviews.auditorId, auditorId)).get()) return true;
  if (db.select({ id: financeAuditRemarks.id }).from(financeAuditRemarks).where(eq(financeAuditRemarks.authorAuditorId, auditorId)).get()) return true;
  if (db.select({ id: financeAuditReportResults.id }).from(financeAuditReportResults).where(eq(financeAuditReportResults.auditorId, auditorId)).get()) return true;
  if (db.select({ at: financeAuditReportDeviations.updatedAt }).from(financeAuditReportDeviations).where(eq(financeAuditReportDeviations.auditorId, auditorId)).get()) return true;
  if (db.select({ id: financeAuditReportScans.id }).from(financeAuditReportScans).where(eq(financeAuditReportScans.auditorId, auditorId)).get()) return true;
  if (db.select({ id: financeAuditReports.id }).from(financeAuditReports).where(eq(financeAuditReports.nonSignerAuditorId, auditorId)).get()) return true;
  if (db.select({ id: financeCashCountWitnesses.countId }).from(financeCashCountWitnesses).where(eq(financeCashCountWitnesses.auditorId, auditorId)).get()) return true;
  return false;
}

/**
 * Recht und Eintrag als Prüfer des Jahres — gemeinsam für Stichproben, „durchgesehen“ und Vermerke. Den Kanal
 * (persönlicher Schritt, `requireHumanChannelFinance`) prüft jeder Dienst selbst gleich nach dem Recht.
 */
export function requireAuditorOfYear(deps: Deps, ctx: CallContext, fiscalYearId: string): { failure: Failure } | { year: FinanceFiscalYearRow; auditor: FinanceAuditAuditorRow } {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return { failure: denied };
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return { failure: notFound('financeFiscalYear', fiscalYearId) };
  const auditor = auditorOfInternal(deps.db, ctx.userId, fiscalYearId);
  if (!auditor) return { failure: financeConflict('auditorRequired', { designation: year.designation }) };
  return { year, auditor };
}


/**
 * Getrennte Berichte warten auf einen Scan je Prüfer: Solange einer „zum Unterschreiben“ liegt, ändert sich die Zahl
 * der Prüfer des Jahres nicht (sonst bliebe er hängen oder bräuchte einen Scan mehr).
 */
export function auditorsFrozenInternal(db: DbOrTx, fiscalYearId: string): boolean {
  return Boolean(db.select({ id: financeAuditReports.id }).from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), eq(financeAuditReports.state, 'readyToSign'), eq(financeAuditReports.signatureMode, 'separate'))).get());
}
