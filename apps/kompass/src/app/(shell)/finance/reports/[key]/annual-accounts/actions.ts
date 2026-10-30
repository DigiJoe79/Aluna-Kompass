'use server';

import { attachSignedAnnualAccountsScan, publishAnnualAccounts, requestAnnualAccountsSignature, saveAnnualAccountsExplanation, signAnnualAccounts, withdrawAnnualAccounts } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Jahresrechnung (Plan U1): Erläuterung, Abzeichnung, Webseite. Jede ruft genau einen Dienst des
 * Finanzmoduls; Rechte, Prüfung und Protokoll stehen dort. Danach werden Liste und Berichte neu aufgebaut.
 */
function revalidate(): void {
  revalidatePath('/finance/reports', 'layout');
}

/** Erläuterung speichern; `expectedVersion` ist der Stand, mit dem der Dialog öffnete (Konflikt in zwei Tabs). */
export async function saveAnnualAccountsExplanationAction(input: { fiscalYearId: string; text: string; expectedVersion: string | null }): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#saveAnnualAccountsExplanationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAnnualAccountsExplanation(deps, ctx, { fiscalYearId: input.fiscalYearId, text: input.text, expectedVersion: input.expectedVersion });
    revalidate();
    return toActionState(result, t, result.ok ? t('finance.reports.annualAccounts.explanation.saved') : undefined);
  });
}

/** Selbst abzeichnen (Designer 1d): nur die Fassung — Name, Amt und Tag nimmt der Dienst aus der Rolle. */
export async function signAnnualAccountsAction(reportId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#signAnnualAccountsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await signAnnualAccounts(deps, ctx, { reportId });
    revalidate();
    return toActionState(result, t, result.ok ? t('finance.reports.annualAccounts.sign.done') : undefined);
  });
}

/** Um Abzeichnung bitten (Designer 1g): Wiedervorlage an das Konto des Vertreters; der Erfolg nennt die Mail. */
export async function requestAnnualAccountsSignatureAction(input: { reportId: string; contactId: string; dueAt: string; name: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#requestAnnualAccountsSignatureAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await requestAnnualAccountsSignature(deps, ctx, { reportId: input.reportId, contactId: input.contactId, dueAt: input.dueAt });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    const mail = result.value.notice.mail;
    return { status: 'success', message: mail === 'sent' ? t('finance.reports.annualAccounts.request.doneMail', { name: input.name }) : t('finance.reports.annualAccounts.request.done'), data: { mail } };
  });
}

/** Den unterschriebenen Scan ablegen (Muster `uploadAuditReportAction`); ohne Datei nennt der Dienst das Feld. */
export async function attachSignedAnnualAccountsScanAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#attachSignedAnnualAccountsScanAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    const result = await attachSignedAnnualAccountsScan(deps, ctx, {
      reportId: String(formData.get('reportId') ?? ''),
      contactId: String(formData.get('contactId') ?? ''),
      signedOn: String(formData.get('signedOn') ?? ''),
      bytes,
      ...(file instanceof File && file.name ? { fileName: file.name } : {}),
    });
    revalidate();
    return toActionState(result, t, result.ok ? t('finance.reports.annualAccounts.scan.done') : undefined);
  });
}

/** Für die Webseite bereitstellen (Designer 1c A, 1e); vor der MV mit Grund, sonst ohne. */
export async function publishAnnualAccountsAction(input: { reportId: string; earlyReason?: 'itzDeadline' | 'funderRequest' | 'other'; earlyNote?: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#publishAnnualAccountsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await publishAnnualAccounts(deps, ctx, input);
    revalidate();
    revalidatePath('/');
    return toActionState(result, t, result.ok ? t('finance.reports.annualAccounts.publish.done') : undefined);
  });
}

/** Von der Webseite nehmen bzw. die Bereitstellung zurücknehmen, wenn sie nie online war (umkehrbar, ohne Grund). */
export async function withdrawAnnualAccountsAction(reportId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/reports/[key]/annual-accounts/actions.ts#withdrawAnnualAccountsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await withdrawAnnualAccounts(deps, ctx, { reportId });
    revalidate();
    revalidatePath('/');
    return toActionState(result, t, result.ok ? (result.value.withdrawnLiveSince ? t('finance.reports.annualAccounts.withdraw.done') : t('finance.reports.annualAccounts.retract.done')) : undefined);
  });
}
