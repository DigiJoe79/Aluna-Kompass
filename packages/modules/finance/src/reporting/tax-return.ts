import { hasPermission, notFound, ok, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { taxPeriodInternal, type TaxPeriodView } from '../ledger/tax-periods';
import { financeAssemblyResults, financeReports } from '../schema';
import { reportDefinition } from './catalog';
import type { GemAttachmentKey, TaxReturnGemReport } from './reports/tax-return-gem';
import { runFinanceReport, runReportInternal } from './service';
import type { ReportParams, ReportRun, ReportStage } from './types';

/**
 * Die Steuererklärung eines Erklärungszeitraums (Plan D2 Task 5): der Lauf von `taxReturnGem` und je Beilage ihr Stand
 * — ein Bericht mit der Stufe derselben Parameter, ein Dokument als vorhanden oder fehlend. Der Stand der Beilagen
 * steht nur hier, nie in den Daten des Berichts (Hash). Für die Seite „Steuererklärung“ und MCP.
 */
export interface TaxReturnView {
  period: TaxPeriodView;
  run: ReportRun<TaxReturnGemReport>;
  attachments: { key: GemAttachmentKey; params?: ReportParams; fiscalYearId?: string; state: ReportStage | 'missing' | 'present' }[];
  me: { canEdit: boolean; canFinalize: boolean };
  /**
   * Abgegeben, aber die festgeschriebene Fassung ist zurückgenommen (Wiederöffnen) und keine neue gilt: wann sie
   * festgeschrieben und wann sie zurückgenommen wurde (Designer Runde 7, 318) — sonst `null`.
   */
  retracted: { reportId: string; finalizedAt: string; voidedAt: string; documentNumber: string } | null;
}

const schema = z.object({ taxPeriodId: z.string().min(1) });

/** `finance.read`: Werte, Beilagen und Hinweise der Anlage Gem zu einem Erklärungszeitraum. */
export async function getTaxReturn(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TaxReturnView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const period = taxPeriodInternal(deps.db, parsed.value.taxPeriodId);
  if (!period) return notFound('financeTaxPeriod', parsed.value.taxPeriodId);
  const run = await runFinanceReport(deps, ctx, { report: 'taxReturnGem', params: { taxPeriodId: period.id } });
  if (!run.ok) return run;
  const data = run.value.data as TaxReturnGemReport;
  const attachments = data.attachments.map((a) => {
    let state: ReportStage | 'missing' | 'present' = 'missing';
    if (a.key === 'activityReport') state = period.documents.activityReport ? 'present' : 'missing';
    else if (a.key === 'statute') state = period.documents.statute ? 'present' : 'missing';
    else if (a.key === 'assemblyMinutes') state = a.fiscalYearId && deps.db.select({ id: financeAssemblyResults.minutesDocumentId }).from(financeAssemblyResults).where(eq(financeAssemblyResults.fiscalYearId, a.fiscalYearId)).get()?.id ? 'present' : 'missing';
    else if (a.params) {
      const def = reportDefinition(a.key);
      if (def?.available && !def.checkParams?.(deps.db, a.params)) state = runReportInternal(deps, deps.db, def, a.params).stage;
    }
    return { ...a, state };
  });
  // Die abgegebene Fassung ist zurückgenommen (Wiederöffnen), und keine neue gilt (318) — aus `filedReportVoided`.
  const filedRow = period.filedOn && period.filedReportVoided && period.filedReportId && run.value.stage !== 'final' ? deps.db.select().from(financeReports).where(eq(financeReports.id, period.filedReportId)).get() : undefined;
  const retracted = filedRow?.voidedAt ? { reportId: filedRow.id, finalizedAt: filedRow.finalizedAt, voidedAt: filedRow.voidedAt, documentNumber: filedRow.documentNumber } : null;
  return ok({ period, run: run.value as ReportRun<TaxReturnGemReport>, attachments, retracted, me: { canEdit: hasPermission(ctx, 'finance.periodClose'), canFinalize: hasPermission(ctx, 'finance.reportsFinalize') } });
}
