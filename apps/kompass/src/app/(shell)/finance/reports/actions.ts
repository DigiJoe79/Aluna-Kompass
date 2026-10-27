'use server';

import { cancelDataExport, fileAuditReportFromDocument, fileAuditReportScan, finalizeFinanceReport, releaseReportsForFinalizing, startDataExport, type ReleaseBasis, type ReportParams } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Berichte (Rechenschaft A3). Jede ruft genau einen Dienst des Finanzmoduls; Rechte, Prüfung und
 * Protokoll stehen dort. Die Freigabe gilt dem Jahr: Liste und jeder Bericht werden neu aufgebaut.
 */
function revalidate(): void {
  revalidatePath('/finance/reports', 'layout');
}

/**
 * Freigabe zum Festschreiben (Board 11b): Grund, bei Bedarf Begründung. Beim schriftlichen Prüfbericht gibt die Ablage
 * des Scans frei (Rechenschaft D1, `fileAuditReportFromDocument`) — ein schon hochgeladener Scan ändert nichts mehr.
 */
export async function releaseYearAction(fiscalYearId: string, basis: ReleaseBasis, note: string, documentId: string | null = null): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/actions.ts#releaseYearAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const trimmed = note.trim();
    if (basis === 'auditReport' && documentId) {
      const filed = await fileAuditReportFromDocument(deps, ctx, { fiscalYearId, documentId });
      revalidate();
      return toActionState(filed, t);
    }
    const result = await releaseReportsForFinalizing(deps, ctx, { fiscalYearId, basis, note: trimmed ? trimmed : null, documentId });
    revalidate();
    return toActionState(result, t);
  });
}

/** Den Scan des Prüfberichts am Geschäftsjahr ablegen — das gibt das Jahr zugleich frei (Rechenschaft D1). */
export async function uploadAuditReportAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/actions.ts#uploadAuditReportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const fiscalYearId = String(formData.get('fiscalYearId') ?? '');
    const result = await fileAuditReportScan(deps, ctx, { fiscalYearId, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { documentId: result.value.documentId, documentNumber: result.value.documentNumber, subject: file.name } };
  });
}

/** Festschreiben (Board 2b): dieselben Parameter wie Seite und Vorschau, damit der Hash derselbe ist. */
export async function finalizeReportAction(report: string, params: ReportParams): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/actions.ts#finalizeReportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await finalizeFinanceReport(deps, ctx, { report, params });
    revalidate();
    return toActionState(result, t, result.ok ? t('finance.reports.view.confirm.done', { number: result.value.documentNumber }) : undefined);
  });
}

/** „Erzeugen“ im Dialog „Datenexport erzeugen“ (Board 13f): startet den Lauf; läuft schon einer, meldet der Dienst ihn. */
export async function startDataExportAction(fiscalYearIds: string[]): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/actions.ts#startDataExportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await startDataExport(deps, ctx, { fiscalYearIds }), t);
  });
}

/** „Abbrechen“ am laufenden Datenexport. */
export async function cancelDataExportAction(): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/actions.ts#cancelDataExportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await cancelDataExport(deps, ctx, {}), t);
  });
}
