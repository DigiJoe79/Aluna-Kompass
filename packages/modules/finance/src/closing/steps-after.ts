import { contacts, displayName } from '@kompass/module-contacts';
import { eq, inArray } from 'drizzle-orm';
import { auditDoneInternal, auditorsOfYearInternal } from '../auditing/access';
import { auditorAccessInternal } from '../auditing/auditors';
import { baselineShortHashInternal, changedSinceInternal, referenceBaselineInternal } from '../auditing/baseline';
import { carryOverOfYearInternal } from '../auditing/carry-over';
import { auditPackageStatusInternal } from '../auditing/package-run';
import { currentReportInternal, followUpOpenInternal, lastFiledReportInternal } from '../auditing/report';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { missingStatementPdfsInternal } from '../ledger/statement-documents';
import { taxPeriodOfYearInternal } from '../ledger/tax-periods';
import { REPORT_CATALOG } from '../reporting/catalog';
import { runReportInternal } from '../reporting/service';
import { releaseOfYearInternal } from '../reporting/stage';
import { financeAuditBaselines, financeFiscalYears, financeNotices } from '../schema';
import { assemblyOfYearInternal, assemblyPersonsInternal } from './assembly';
import type { StepContext, StepResult } from './steps-before';
import { vatPeriodViewsInternal } from '../ledger/vat-filings';

/**
 * Rechenschaft C, Schritte 9–12 (Spec § C, Finanz-Spec § 9.6, Plan C1 Task 5): Prüfpaket, Prüfbericht und
 * Festschreiben, Ergebnis der MV, Steuererklärung.
 */

/** Eine Freigabe ohne Prüfung macht Schritt 9 überflüssig (Claude). */
const SKIPS_PACKAGE = new Set(['noAuditProvided', 'notAudited']);

function auditPackageStep(c: StepContext): StepResult {
  const db = c.deps.db;
  const closed = fiscalYearStatusInternal(db, c.year.id) === 'closed';
  const rows = auditorsOfYearInternal(db, c.year.id);
  const names = new Map(rows.length === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, rows.map((r) => r.contactId))).all().map((k) => [k.id, displayName(k)]));
  const auditors = rows.map((a) => {
    const access = a.mode === 'kompass' ? auditorAccessInternal(db, c.deps, a.contactId, a.accessEndedAt) : null;
    return { id: a.id, name: names.get(a.contactId) ?? '', mode: a.mode, accessOk: access === null || (access.userActive && access.hasRole && access.endedAt === null) };
  });
  const status = auditPackageStatusInternal(c.deps, c.year.id);
  const packageRun = !status ? 'none' : status.running ? 'running' : status.last?.status === 'success' && !status.outdated ? 'done' : status.last && status.last.status !== 'success' ? 'failed' : 'none';
  const release = releaseOfYearInternal(db, c.year.id);
  const skippedBy = release && SKIPS_PACKAGE.has(release.basis) ? release.basis : null;
  // Ist die Prüfung abgelegt, war das Paket ihr Mittel — danach endet auch der Zugang (Schritt 11, Claude).
  const audited = auditDoneInternal(db, c.year.id);
  const ready = auditors.length > 0 && auditors.every((a) => a.accessOk) && packageRun === 'done';
  // Das Ergebnis in einer Form (14d): „Prüfpaket vom … · Stand …“ — der Lauf, sonst der Prüfstand des abgelegten Berichts.
  const filed = lastFiledReportInternal(db, c.year.id);
  const baselineId = packageRun === 'done' ? (status?.last?.result?.baselineId ?? null) : (filed?.baselineId ?? null);
  const packageAt = packageRun === 'done' ? (status?.last?.finishedAt ?? null) : baselineId ? (db.select({ createdAt: financeAuditBaselines.createdAt }).from(financeAuditBaselines).where(eq(financeAuditBaselines.id, baselineId)).get()?.createdAt ?? null) : null;
  const pkg = baselineId && packageAt ? { at: packageAt, shortHash: baselineShortHashInternal(db, baselineId) } : null;
  return { done: closed && (skippedBy !== null || audited || ready), confirmable: false, facts: { key: 'auditPackage', auditors, packageRun, skippedBy, package: pkg } };
}

/** Die verfügbaren Berichte der Gruppe MV mit den Parametern des Jahres: wie viele festgeschrieben sind. */
function assemblyReportsOf(c: StepContext): { done: number; total: number } {
  const defs = REPORT_CATALOG.filter((d) => d.group === 'assembly' && d.available);
  if (fiscalYearStatusInternal(c.deps.db, c.year.id) !== 'closed') return { done: 0, total: defs.length };
  const done = defs.filter((def) => runReportInternal(c.deps, c.deps.db, def, { fiscalYearId: c.year.id }).stage === 'final').length;
  return { done, total: defs.length };
}

function auditReportStep(c: StepContext): StepResult {
  const db = c.deps.db;
  const release = releaseOfYearInternal(db, c.year.id);
  const followUpOpen = followUpOpenInternal(db, c.year.id);
  const reference = referenceBaselineInternal(db, c.year.id);
  const baselineAt = reference ? (db.select({ createdAt: financeAuditBaselines.createdAt }).from(financeAuditBaselines).where(eq(financeAuditBaselines.id, reference)).get()?.createdAt ?? null) : null;
  const followUp = currentReportInternal(db, c.year.id, 'followUp');
  const openFollowUp = followUp && followUp.state !== 'filed' ? followUp : null;
  const assemblyReports = assemblyReportsOf(c);
  const facts = {
    key: 'auditReport' as const,
    release,
    filedAt: lastFiledReportInternal(db, c.year.id)?.filedAt ?? null,
    followUpOpen,
    changedEntries: followUpOpen && reference ? changedSinceInternal(db, c.year.id, reference).length : 0,
    baselineAt,
    afterAssembly: assemblyOfYearInternal(db, c.year.id) !== null,
    followUpReportId: openFollowUp?.id ?? null,
    followUpReadyToSign: openFollowUp?.state === 'readyToSign',
    assemblyReports,
    statementsMissing: missingStatementPdfsInternal(db, c.year.id),
    carryOver: carryOverOfYearInternal(db, c.year.id),
  };
  // Nachprüfung ohne geänderte Buchung (Befund 3): nur bestätigen — im abgeschlossenen Jahr, sonst kann sich noch etwas ändern.
  const confirmable = followUpOpen && facts.changedEntries === 0 && fiscalYearStatusInternal(db, c.year.id) === 'closed';
  return { done: release !== null && !followUpOpen && assemblyReports.done === assemblyReports.total, confirmable, facts };
}

/** Mit Ergebnis: die nicht erteilten Entlastungen mit Namen, für den Kopf „Offen: Entlastung von …, vertagt.“ (14b). */
function assemblyStep(c: StepContext): StepResult {
  const result = assemblyOfYearInternal(c.deps.db, c.year.id);
  const names = result && result.dischargeMode === 'individual' ? new Map(assemblyPersonsInternal(c.deps.db, c.year).map((p) => [p.contactId, p.name])) : new Map<string, string>();
  const pending = result ? result.discharges.filter((d) => d.outcome !== 'granted').map((d) => ({ name: names.get(d.contactId) ?? '', outcome: d.outcome })) : [];
  return { done: result?.complete ?? false, confirmable: false, facts: { key: 'assembly', result, pending } };
}

/**
 * E6a: Schritt 12 nennt die Umsatzsteuer-Jahreserklärung des Kalenderjahres, dessen 31.12. im Geschäftsjahr liegt
 * (ein Rumpfjahr ohne 31.12. nennt keine). E11 (Befund 34 a): Ist sie Pflicht und nicht abgegeben, bleibt der Schritt
 * offen — auch wenn die Steuererklärung abgegeben oder bestätigt ist; `confirmable` hängt weiter nur an der Steuererklärung.
 */
function vatOfYear(c: StepContext): { calendarYear: number; dueOn: string; filedOn: string | null; reason: 'regular' | 'section18_4a'; overdue: boolean } | null {
  const calendarYear = Number(c.year.endsOn.slice(0, 4)) - (c.year.endsOn.slice(5) === '12-31' ? 0 : 1);
  if (`${calendarYear}-12-31` < c.year.startsOn) return null;
  const { annual } = vatPeriodViewsInternal(c.deps.db, calendarYear, c.today);
  if (!annual.required) return null;
  // Der Grund steht im Satz (Board Umsatzsteuer 6a): „weil es Umsätze nach § 13b gibt“ bzw. „weil der Verein regelbesteuert ist“.
  const filedOn = annual.filings.at(-1)?.filedOn ?? null;
  // Designer Runde 8, 17e: verstrichen ohne Abgabe — die Marke „überfällig“ hinter dem Satz.
  return { calendarYear, dueOn: annual.dueOn!, filedOn, reason: annual.reason ?? 'section18_4a', overdue: filedOn === null && annual.dueOn! < c.today };
}

/**
 * Schritt 12 (Rechenschaft D2, Claude): Gehört das Jahr zu einem Erklärungszeitraum, entscheidet dessen Abgabe — abgegeben
 * → erledigt; ein Jahr, das nicht das letzte eines offenen Zeitraums ist, ist ohne Bestätigung erledigt (abgegeben wird
 * nach dem letzten); das letzte Jahr eines offenen Zeitraums wartet auf die Abgabe und ist nicht bestätigbar. Ohne
 * Zeitraum bleibt es bei „dieses Jahr nicht fällig“, bestätigt mit Text. In jedem Fall wartet der Schritt zusätzlich auf
 * eine fällige USt-Jahreserklärung (`vatOfYear`).
 */
function taxReturnStep(c: StepContext): StepResult {
  const period = taxPeriodOfYearInternal(c.deps.db, c.year.id);
  const vat = vatOfYear(c);
  const vatSettled = vat === null || vat.filedOn !== null;
  if (!period) return { done: c.confirmation('taxReturn') !== null && vatSettled, confirmable: true, facts: { key: 'taxReturn', period: null, vat } };
  const lastYear = period.lastFiscalYearId === c.year.id;
  const last = c.deps.db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, period.lastFiscalYearId)).get()?.designation ?? '';
  // Der Bescheid nur, solange er trägt (ein stornierter trug nie, Befund 17 a); mit Tag und Dokument (Board 15h D).
  const notice = period.state === 'assessed' && period.noticeId ? c.deps.db.select({ noticeOn: financeNotices.noticeDate, documentId: financeNotices.documentId }).from(financeNotices).where(eq(financeNotices.id, period.noticeId)).get() ?? null : null;
  const facts = { key: 'taxReturn' as const, period: { id: period.id, label: period.label, dueOn: period.dueOn, filedOn: period.filedOn, lastYear, last, overdue: period.filedOn === null && period.dueOn < c.today, notice }, vat };
  return { done: (period.filedOn !== null || !lastYear) && vatSettled, confirmable: false, facts };
}

export const STEPS_AFTER: Record<'auditPackage' | 'auditReport' | 'assembly' | 'taxReturn', (c: StepContext) => StepResult> = {
  auditPackage: auditPackageStep,
  auditReport: auditReportStep,
  assembly: assemblyStep,
  taxReturn: taxReturnStep,
};
