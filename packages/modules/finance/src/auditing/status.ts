import { listUserNamesWithPermission, notFound, ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { financeAuditBaselines, financeFiscalYears } from '../schema';
import { cashCountsAfterInternal } from './cash-witnesses';
import { packageRunSummaryInternal } from './package-run';
import { auditDoneInternal, auditorOfInternal, auditWorkFixedSinceInternal, auditorsOfYearInternal, isReportEditorInternal, requireAuditRead } from './access';
import { auditorAccessInternal } from './auditors';
import { changedSinceInternal, latestBaselineInternal, referenceBaselineInternal } from './baseline';
import { openRemarksByTargetInternal } from './remarks';
import { currentReportInternal, followUpConfirmedAtInternal, followUpConfirmedUnchangedInternal, followUpOpenInternal, reportViewInternal } from './report';
import { sampleCountInternal } from './samples';
import { previousReviewsInternal, sectionReviewStatesInternal } from './sections';
import { AUDIT_SECTIONS, type AuditStatus } from './types';

/**
 * Der Stand der Kassenprüfung eines Jahres (Spec § D1, Designer 4a/12a): Prüfstand, Änderungen seit ihm, Abschnitte,
 * Vermerke, Bericht, Zugang, Kassenzählung, und was der Aufrufer selbst darf. Live gerechnet.
 */
export function auditStatusInternal(deps: Deps, ctx: CallContext, fiscalYearId: string): AuditStatus {
  const db: DbOrTx = deps.db;
  const latest = latestBaselineInternal(db, fiscalYearId);
  const referenceBaselineId = referenceBaselineInternal(db, fiscalYearId);
  const auditors = auditorsOfYearInternal(db, fiscalYearId);
  const reviews = sectionReviewStatesInternal(deps, fiscalYearId);
  const reportRow = currentReportInternal(db, fiscalYearId);
  const report = reportRow ? reportViewInternal(deps, ctx, reportRow) : null;
  const reference = referenceBaselineId ? db.select({ createdAt: financeAuditBaselines.createdAt, kind: financeAuditBaselines.kind }).from(financeAuditBaselines).where(eq(financeAuditBaselines.id, referenceBaselineId)).get() : null;
  const cashCounts = reference ? cashCountsAfterInternal(db, fiscalYearId, reference) : [];
  const open = auditors.filter((a) => a.mode === 'kompass').filter((a) => auditorAccessInternal(db, deps, a.contactId, a.accessEndedAt).hasRole).length;
  return {
    fiscalYearId,
    yearStatus: fiscalYearStatusInternal(db, fiscalYearId),
    baseline: latest ? { id: latest.id, createdAt: latest.createdAt, kind: latest.kind } : null,
    referenceBaselineId,
    changedEntryIds: referenceBaselineId ? changedSinceInternal(db, fiscalYearId, referenceBaselineId) : [],
    sectionsReviewed: AUDIT_SECTIONS.map((section) => ({ section, auditorIds: reviews.filter((r) => r.section === section && r.current).map((r) => r.auditorId) })).filter((s) => s.auditorIds.length > 0),
    sectionsReviewedBefore: previousReviewsInternal(reviews),
    samples: sampleCountInternal(db, fiscalYearId),
    remarksUnresolved: [...openRemarksByTargetInternal(db, fiscalYearId).values()].reduce((a, b) => a + b, 0),
    report: report ? { id: report.id, kind: report.kind, origin: report.origin, state: report.state, scansExpected: report.scansExpected, scansFiled: report.scans.length, editorNames: report.editorNames, lastEditedAt: report.lastEditedAt, lastPrintedAt: report.lastPrintedAt } : null,
    followUpOpen: followUpOpenInternal(db, fiscalYearId),
    followUpConfirmedAt: followUpConfirmedUnchangedInternal(db, fiscalYearId) ? followUpConfirmedAtInternal(db, fiscalYearId) : null,
    workFixedSince: auditWorkFixedSinceInternal(db, fiscalYearId),
    auditorsWithOpenAccess: open,
    cashCount: cashCounts[0] ?? null,
    cashCounts,
    cashKeepers: listUserNamesWithPermission(deps, 'finance.entriesFinalize'),
    packageRun: packageRunSummaryInternal(deps, fiscalYearId),
    me: { auditorId: auditorOfInternal(db, ctx.userId, fiscalYearId)?.id ?? null, canEditReport: isReportEditorInternal(db, ctx, fiscalYearId) && !auditDoneInternal(db, fiscalYearId) },
  };
}

const yearSchema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.read` oder `finance.audit`, auch über MCP. */
export async function getAuditStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditStatus>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, yearSchema, input);
  if (!parsed.ok) return parsed;
  if (!deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get()) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok(auditStatusInternal(deps, ctx, parsed.value.fiscalYearId));
}
