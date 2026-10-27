'use server';

import { carryOverAuditFollowUp, closeFiscalYear, fileAssemblyMinutes, saveAssemblyResult, type DischargeOutcome, confirmAccountForYear, confirmClosingStep, fileAccountStatementDocument, linkAccountStatementDocument, reopenFiscalYear, suggestStatementPeriod, type AccountYearConfirmationKind, type ClosingStepKey } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions des Jahresabschlusses (Rechenschaft C2). Jede ruft genau einen Dienst des Finanzmoduls; Rechte,
 * Prüfung und Protokoll stehen dort. Der Stand gilt dem Jahr: Jahresabschluss und Berichte werden neu aufgebaut.
 */
function revalidate(): void {
  revalidatePath('/finance/closing', 'layout');
  revalidatePath('/finance/reports', 'layout');
}

/** Einen Schritt bestätigen (Board 3b) — mit Begründung, außer Schritt 1 („Alle Auszüge liegen in der Akte“). */
export async function confirmStepAction(fiscalYearId: string, step: ClosingStepKey, note: string | null): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#confirmStepAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const trimmed = note?.trim() ?? '';
    const result = await confirmClosingStep(deps, ctx, { fiscalYearId, step, note: trimmed ? trimmed : null });
    revalidate();
    return toActionState(result, t);
  });
}

/** Schritt 8: das Jahr abschließen. */
export async function closeYearAction(fiscalYearId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#closeYearAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await closeFiscalYear(deps, ctx, { id: fiscalYearId });
    revalidate();
    return toActionState(result, t);
  });
}

/** „Jahr wiederöffnen …“ (⋯ im Kopf) mit Begründung. */
export async function reopenYearAction(fiscalYearId: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#reopenYearAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reopenFiscalYear(deps, ctx, { id: fiscalYearId, note });
    revalidate();
    return toActionState(result, t);
  });
}

export interface StatementSuggestion {
  periodFrom: string | null;
  periodTo: string;
  covers: boolean;
  balanceAtYearEndCents: number;
}

const period = (formData: FormData) => {
  const from = String(formData.get('periodFrom') ?? '').trim();
  return { periodFrom: from ? from : null, periodTo: String(formData.get('periodTo') ?? '') };
};

/** Schritt 1 (Board 13c): einen Auszug als PDF hochladen und dem Konto zuordnen. */
export async function fileStatementAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#fileStatementAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileAccountStatementDocument(deps, ctx, { accountId: String(formData.get('accountId') ?? ''), ...period(formData), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { documentNumber: result.value.documentNumber } };
  });
}

/** Schritt 1: einen Auszug aus der Akte dem Konto zuordnen. */
export async function linkStatementAction(accountId: string, documentId: string, periodFrom: string | null, periodTo: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#linkStatementAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkAccountStatementDocument(deps, ctx, { accountId, documentId, periodFrom, periodTo });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { documentNumber: result.value.documentNumber } };
  });
}

/** „Bis“ (und „Von“) aus dem PDF lesen — ein Vorschlag (MUSTER § E); ohne Texterkennung `null`. */
export async function suggestStatementAction(formData: FormData): Promise<StatementSuggestion | null> {
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  const documentId = String(formData.get('documentId') ?? '');
  const input = { fiscalYearId: String(formData.get('fiscalYearId') ?? ''), accountId: String(formData.get('accountId') ?? ''), ...(file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()) } : { documentId }) };
  const result = await suggestStatementPeriod(deps, ctx, input);
  return result.ok ? result.value : null;
}

/** Je Konto: Kontostand bestätigt, nicht abstimmbar (Zahlungsdienst) oder Fehlen begründet (Bankkonto). */
export async function confirmAccountAction(fiscalYearId: string, accountId: string, kind: AccountYearConfirmationKind, note: string | null): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#confirmAccountAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const trimmed = note?.trim() ?? '';
    const result = await confirmAccountForYear(deps, ctx, { fiscalYearId, accountId, kind, note: trimmed ? trimmed : null });
    revalidate();
    return toActionState(result, t);
  });
}

/** „Schritt erledigen“ in Schritt 1: „Alle Auszüge des Jahres liegen in der Akte“, ohne Begründung. */
export async function confirmStatementsStepAction(fiscalYearId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#confirmStatementsStepAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await confirmClosingStep(deps, ctx, { fiscalYearId, step: 'statements', note: null });
    revalidate();
    return toActionState(result, t);
  });
}

/** Nachprüfung nach der MV (Board 10c): „In das Folgejahr übernehmen“ mit Begründung. */
export async function carryOverAction(fiscalYearId: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#carryOverAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await carryOverAuditFollowUp(deps, ctx, { fiscalYearId, note });
    revalidate();
    revalidatePath('/finance/audit', 'layout');
    return toActionState(result, t);
  });
}

export interface SaveAssemblyInput {
  fiscalYearId: string;
  assemblyOn: string;
  /** Weggelassen: das Protokoll bleibt, wie es ist. */
  minutesDocumentId?: string | null;
  accountsApproved: 'yes' | 'no' | 'notVoted' | null;
  dischargeMode: 'individual' | 'collective';
  collectiveOutcome: DischargeOutcome | null;
  discharges: { contactId: string; outcome: DischargeOutcome | null }[];
  expectedVersion?: string;
}

/** Schritt 11 (Board 13d): das Ergebnis der Mitgliederversammlung speichern; „vertagt“ lässt den Schritt offen. */
export async function saveAssemblyAction(input: SaveAssemblyInput): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#saveAssemblyAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAssemblyResult(deps, ctx, { ...input, assemblyOn: input.assemblyOn || undefined });
    revalidate();
    revalidatePath('/finance/audit', 'layout');
    return toActionState(result, t);
  });
}

/** Schritt 11: das Protokoll der MV als PDF hochladen (erst nach gespeichertem Ergebnis). */
export async function uploadMinutesAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/actions.ts#uploadMinutesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileAssemblyMinutes(deps, ctx, { fiscalYearId: String(formData.get('fiscalYearId') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    return toActionState(result, t);
  });
}
