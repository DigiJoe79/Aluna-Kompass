import { hasPermission, invalid, isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { abortReceive, documents, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance, uploadLimitProblem } from '../errors';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { AUDIT_REPORT_TYPE_KEY, releaseReportsInternal } from '../reporting/finalize';
import { releaseChangeableInternal, releaseOfYearInternal } from '../reporting/stage';
import { financeAuditAuditors, financeAuditReports, financeAuditReportScans, financeFiscalYears, type FinanceAuditReportRow, type FinanceFiscalYearRow } from '../schema';
import { auditorsOfYearInternal, isReportEditorInternal } from './access';
import { createReportInternal, currentReportInternal, followUpOpenInternal, loadReport, reportViewInternal, scansExpectedInternal, scansOfInternal, subjectSnapshotInternal, type AuditReportView } from './report';

/**
 * Den unterschriebenen Prüfbericht ablegen (Spec § D1 Schritt 7, Muster „unterschrieben ablegen“): als Eingang am
 * Geschäftsjahr (`finance-audit-report`, Bezug `financeFiscalYear`). Mit allen Scans steht der Bericht auf `filed`
 * und das Jahr ist mit `auditReport` zum Festschreiben freigegeben (`releaseReportsInternal`); gültig ist der Scan.
 * Ohne Bericht (A3-Dialog „Schriftlicher Prüfbericht“, nur Papier) entsteht ein Vordruck-Bericht `origin: blank`.
 */

/** Höchstgröße eines Scans (Plan D1a Task 7). */
export const AUDIT_SCAN_MAX_BYTES = 10 * 1024 * 1024;

export interface AuditFilingResult {
  report: AuditReportView;
  documentId: string;
  documentNumber: string;
  /** Die Freigabe war schon die Grundlage eines festgeschriebenen Berichts und blieb, wie sie war. */
  releaseKept: boolean;
}

const target = {
  /** Der Bericht; ohne ihn der zu ablegende Bericht des Jahres (`fiscalYearId`). */
  reportId: z.string().min(1).optional(),
  fiscalYearId: z.string().min(1).optional(),
  /** Bei getrennten Berichten Pflicht: wessen Bericht der Scan ist. */
  auditorId: z.string().min(1).nullable().optional(),
};
const scanSchema = z
  .object({ ...target, bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional() })
  .refine((v) => Boolean(v.reportId) !== Boolean(v.fiscalYearId), { path: ['reportId'], message: 'reportOrYear' });
const documentSchema = z.object({ ...target, documentId: z.string().min(1) }).refine((v) => Boolean(v.reportId) !== Boolean(v.fiscalYearId), { path: ['reportId'], message: 'reportOrYear' });

type Target = { reportId?: string | undefined; fiscalYearId?: string | undefined; auditorId?: string | null | undefined };

/**
 * Bericht, Jahr und Prüfer der Ablage auflösen und prüfen: Bearbeiter oder `finance.periodClose`; Bericht
 * „zum Unterschreiben“; getrennte Berichte verlangen den Prüfer, sonst keiner; kein zweiter Scan desselben Teils.
 * `create`: Ohne Bericht entsteht in der Transaktion ein Vordruck-Bericht (nur `finance.periodClose`).
 */
function resolveTarget(deps: Deps, ctx: CallContext, v: Target): Result<{ year: FinanceFiscalYearRow; report: FinanceAuditReportRow | null; kind: 'report' | 'followUp'; auditorId: string | null }> {
  let report = v.reportId ? loadReport(deps.db, v.reportId) : null;
  if (v.reportId && !report) return notFound('financeAuditReport', v.reportId);
  const yearId = report?.fiscalYearId ?? v.fiscalYearId!;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get();
  if (!year) return notFound('financeFiscalYear', yearId);
  const periodClose = hasPermission(ctx, 'finance.periodClose');
  if (!periodClose && !isReportEditorInternal(deps.db, ctx, year.id)) return hasPermission(ctx, 'finance.audit') ? financeConflict('auditorRequired', { designation: year.designation }) : (requirePermission(ctx, 'finance.periodClose') as Failure);
  if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') return financeConflict('auditReportYearOpen', { designation: year.designation });
  const followUp = followUpOpenInternal(deps.db, year.id);
  if (!report) {
    const latest = currentReportInternal(deps.db, year.id);
    if (latest && latest.state !== 'filed') report = latest;
    else if (latest && !followUp) return financeConflict('auditReportFiled', { designation: year.designation });
    else if (!periodClose) return requirePermission(ctx, 'finance.periodClose') as Failure;
    // Der Vordruck gilt nur, wenn niemand in Kompass prüft (wie `printAuditReportBlank`).
    else if (auditorsOfYearInternal(deps.db, year.id).some((a) => a.mode === 'kompass')) return financeConflict('auditBlankKompassAuditor', { designation: year.designation });
  }
  if (report && report.state !== 'readyToSign') return report.state === 'filed' ? financeConflict('auditReportFiled', { designation: year.designation }) : financeConflict('auditReportNotReadyToSign');
  const separate = report?.signatureMode === 'separate';
  if (separate && !v.auditorId) return invalid([{ path: 'auditorId', message: 'required' }]);
  if (!separate && v.auditorId) return invalid([{ path: 'auditorId', message: 'notSeparate' }]);
  if (separate) {
    const auditor = deps.db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.id, v.auditorId!)).get();
    if (!auditor || auditor.fiscalYearId !== year.id) return invalid([{ path: 'auditorId', message: 'notAnAuditorOfYear' }]);
    if (scansOfInternal(deps.db, report!.id).some((s) => s.auditorId === auditor.id)) return financeConflict('auditReportFiled', { designation: year.designation });
  }
  return ok({ year, report, kind: followUp ? 'followUp' : 'report', auditorId: separate ? v.auditorId! : null });
}

/** In der Transaktion der Ablage: Scan eintragen; mit allen Scans `filed` und Freigabe `auditReport`. */
function recordScanInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, resolved: { year: FinanceFiscalYearRow; report: FinanceAuditReportRow | null; kind: 'report' | 'followUp'; auditorId: string | null }, documentId: string): { report: FinanceAuditReportRow; releaseKept: boolean } {
  const report = resolved.report ?? createReportInternal(tx, deps, ctx, resolved.year, resolved.kind, 'blank');
  const now = isoNow(deps.clock);
  tx.insert(financeAuditReportScans).values({ id: newId(), reportId: report.id, auditorId: resolved.auditorId, documentId, filedAt: now, filedByUserId: ctx.userId ?? 'system' }).run();
  const scans = scansOfInternal(tx, report.id);
  const complete = scans.length >= scansExpectedInternal(tx, report);
  let releaseKept = false;
  if (complete) {
    // Ein Vordruck (oder ein Bericht von vor dem Schnappschuss) bekommt seinen Gegenstand spätestens mit der Ablage.
    const subjectSnapshot = report.subjectSnapshot ?? subjectSnapshotInternal({ ...deps, db: tx }, loadReport(tx, report.id)!);
    tx.update(financeAuditReports).set({ state: 'filed', filedAt: now, subjectSnapshot }).where(eq(financeAuditReports.id, report.id)).run();
    const release = releaseOfYearInternal(tx, resolved.year.id);
    const first = scans[0]!.documentId;
    if (release && !releaseChangeableInternal(tx, resolved.year.id)) releaseKept = true;
    else if (!release || release.basis !== 'auditReport' || release.documentId !== first) releaseReportsInternal(tx, deps, ctx, { fiscalYearId: resolved.year.id, basis: 'auditReport', note: null, documentId: first });
  }
  financeAudit(tx, deps, ctx, { action: 'finance.audit.report.file', entity: 'financeAuditReport', id: report.id, after: { fiscalYearId: resolved.year.id, kind: report.kind, origin: report.origin, state: complete ? 'filed' : report.state, scanCount: scans.length, documentId }, params: { designation: resolved.year.designation, kind: report.kind, scans: scans.length, expected: scansExpectedInternal(tx, report) } });
  return { report: loadReport(tx, report.id)!, releaseKept };
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

/**
 * Bearbeiter oder `finance.periodClose`: den Scan (PDF bis 10 MB) hochladen und ablegen. Bei getrennten Berichten
 * einen je Prüfer (`auditorId`); nach dem ersten von zweien zeigt der Bericht „1 von 2“.
 */
export async function fileAuditReportScan(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditFilingResult>> {
  if (!hasPermission(ctx, 'finance.periodClose') && !hasPermission(ctx, 'finance.audit')) return requirePermission(ctx, 'finance.periodClose')!;
  // Die Ablage gibt das Jahr frei — eine persönliche Erklärung wie `releaseReportsForFinalizing` (humanOnly).
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, scanSchema, input);
  if (!parsed.ok) return parsed;
  const tooLarge = uploadLimitProblem(deps, parsed.value.bytes);
  if (tooLarge) return tooLarge;
  const v = parsed.value;
  if (v.bytes.length > AUDIT_SCAN_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const resolved = resolveTarget(deps, ctx, v);
  if (!resolved.ok) return resolved;
  const r = resolved.value;
  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: AUDIT_REPORT_TYPE_KEY,
    subject: `${r.kind === 'followUp' || r.report?.kind === 'followUp' ? 'Nachtrag zum Prüfbericht' : 'Prüfbericht'} ${r.year.designation}`,
    documentDate: todayIn(deps),
    // Wer das Jahr abschließt, legt am Jahr ab; ein Prüfer (ohne dieses Recht) am Bericht — die Akte prüft das Recht des Bezugs.
    links: hasPermission(ctx, 'finance.periodClose') || !r.report ? [{ entityType: 'financeFiscalYear', entityId: r.year.id }] : [{ entityType: 'financeAuditReport', entityId: r.report.id }],
    afterReceive: (tx, doc) => {
      // Zwischen Prüfen und Ablegen kann ein anderer abgelegt haben: erneut auflösen.
      const again = resolveTarget({ ...deps, db: tx }, ctx, v);
      if (!again.ok) abortReceive(again);
      const recorded = recordScanInternal(tx, deps, ctx, (again as { value: typeof r }).value, doc.id);
      linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeFiscalYear', entityId: r.year.id });
      linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeAuditReport', entityId: recorded.report.id });
      return recorded;
    },
  });
  if (!result.ok) return result;
  const after = result.value.after!;
  return ok({ report: reportViewInternal(deps, ctx, after.report), documentId: result.value.document.id, documentNumber: result.value.document.number ?? '', releaseKept: after.releaseKept });
}

/**
 * Wie `fileAuditReportScan`, aber mit einem Scan aus der Akte (Art `finance-audit-report`, festgeschrieben, nicht
 * widerrufen); er wird an das Jahr gehängt. Ist das Dokument schon ein Scan dieses Berichts, ändert sich nichts.
 */
export async function fileAuditReportFromDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditFilingResult>> {
  if (!hasPermission(ctx, 'finance.periodClose') && !hasPermission(ctx, 'finance.audit')) return requirePermission(ctx, 'finance.periodClose')!;
  // Die Ablage gibt das Jahr frei — eine persönliche Erklärung wie `releaseReportsForFinalizing` (humanOnly).
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, documentSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const doc = deps.db.select({ typeKey: documents.typeKey, status: documents.status, phase: documents.phase, number: documents.number }).from(documents).where(eq(documents.id, v.documentId)).get();
  if (!doc || doc.typeKey !== AUDIT_REPORT_TYPE_KEY || doc.phase !== 'issued' || doc.status === 'voided') return invalid([{ path: 'documentId', message: 'notAnAuditReport' }]);
  const already = deps.db.select().from(financeAuditReportScans).where(eq(financeAuditReportScans.documentId, v.documentId)).get();
  if (already) {
    const report = loadReport(deps.db, already.reportId)!;
    if (v.reportId && v.reportId !== report.id) return financeConflict('auditReportFiled', { designation: '' });
    return ok({ report: reportViewInternal(deps, ctx, report), documentId: v.documentId, documentNumber: doc.number ?? '', releaseKept: false });
  }
  const resolved = resolveTarget(deps, ctx, v);
  if (!resolved.ok) return resolved;
  return deps.db.transaction((tx: DbOrTx) => {
    linkDocumentInternal(tx, deps, { documentId: v.documentId, entityType: 'financeFiscalYear', entityId: resolved.value.year.id });
    const recorded = recordScanInternal(tx, deps, ctx, resolved.value, v.documentId);
    linkDocumentInternal(tx, deps, { documentId: v.documentId, entityType: 'financeAuditReport', entityId: recorded.report.id });
    return ok({ report: reportViewInternal({ ...deps, db: tx }, ctx, recorded.report), documentId: v.documentId, documentNumber: doc.number ?? '', releaseKept: recorded.releaseKept });
  });
}
