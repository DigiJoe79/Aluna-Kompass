'use server';

import {
  amendMandate,
  buildDirectDebitFile,
  correctMandate,
  endMandate,
  endPledge,
  fileSignedMandate,
  mandateFormPdf,
  pausePledge,
  savePledge,
  cancelDirectDebitRun,
  createDirectDebitRun,
  issuePrenotification,
  markDirectDebitRunSubmitted,
  previewDirectDebitRun,
  removeRunItem,
  resetDirectDebitRunSubmitted,
  resolveDirectDebitReturn,
} from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { messageDate } from '@kompass/core';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Lastschrift (Plan U2). Jede ruft genau einen Dienst aus `@kompass/module-finance`; Rechte,
 * Prüfungen und Protokoll stehen dort.
 */
function revalidate(): void {
  revalidatePath('/finance/direct-debit', 'layout');
}

/** Vorschau eines Einzugs zum Tag (`finance.read`) — die Seite „Neuer Einzug“ zeigt sie in Gruppen. */
export async function previewRunAction(input: { collectionDate: string; accountId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#previewRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await previewDirectDebitRun(deps, ctx, { collectionDate: input.collectionDate, ...(input.accountId ? { accountId: input.accountId } : {}) });
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: '', data: result.value };
  });
}

/** Einzug anlegen (humanOnly): hält fest, was die Vorschau einzieht. */
export async function createRunAction(input: { collectionDate: string; accountId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#createRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createDirectDebitRun(deps, ctx, { collectionDate: input.collectionDate, ...(input.accountId ? { accountId: input.accountId } : {}) });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    // M32: Für denselben Tag liegt schon ein Einzug im Entwurf — der Satz sagt es, damit nicht zwei Dateien entstehen.
    const sameDay = result.value.hints.some((h) => h.code === 'runSameDayDraft') ? ` ${t('finance.directDebit.run.sameDayDraft', { date: messageDate(deps, result.value.collectionDate) })}` : '';
    return { status: 'success', message: `${t('finance.directDebit.run.created', { date: messageDate(deps, result.value.collectionDate), count: result.value.count })}${sameDay}`, data: { id: result.value.id } };
  });
}

export async function buildFileAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#buildFileAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await buildDirectDebitFile(deps, ctx, { runId });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.run.fileCreated'));
  });
}

export async function markSubmittedAction(runId: string, submittedOn: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#markSubmittedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markDirectDebitRunSubmitted(deps, ctx, { runId, submittedOn });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.run.submitted'));
  });
}

export async function resetSubmittedAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#resetSubmittedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resetDirectDebitRunSubmitted(deps, ctx, { runId });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.run.resetDone'));
  });
}

export async function cancelRunAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#cancelRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await cancelDirectDebitRun(deps, ctx, { runId });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.run.cancelled'));
  });
}

export async function removeRunItemAction(itemId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#removeRunItemAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await removeRunItem(deps, ctx, { itemId });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.run.itemRemoved'));
  });
}

export async function resolveReturnAction(input: { returnId: string; resolution: 'recollect' | 'requestTransfer' | 'waive' | 'alreadyPaid'; endMandate: boolean; confirmedAfterObjection?: boolean }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#resolveReturnAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resolveDirectDebitReturn(deps, ctx, input);
    revalidate();
    revalidatePath('/finance/work');
    return toActionState(result, t, t('finance.directDebit.return.resolved'));
  });
}

/** „Ankündigung erzeugen“ aus der Vorschau: ein Brief für genau diesen Tag und Betrag (`issuePrenotification`). */
export async function issueNoticeAction(input: { mandateId: string; dueOn: string; amountCents: number }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#issueNoticeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await issuePrenotification(deps, ctx, { mandateId: input.mandateId, plan: [{ dueOn: input.dueOn, amountCents: input.amountCents }] });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('finance.directDebit.preview.noticeIssued', { number: result.value.number }), data: result.value };
  });
}

// ── Mandat (Handoff 2a § 1.4) ───────────────────────────────────────────────

/** Formular öffnen (PDF): das vorausgefüllte Mandatsformular, ein früheres ohne Änderung seither kommt wieder. */
export async function mandateFormAction(mandateId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#mandateFormAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await mandateFormPdf(deps, ctx, { mandateId });
    revalidate();
    return toActionState(result, t);
  });
}

/** Unterschrift ablegen: die Rücksendung in die Akte, das Mandat aktiv ab dem Tag der Unterschrift. */
export async function fileSignedMandateAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#fileSignedMandateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileSignedMandate(deps, ctx, { mandateId: String(formData.get('mandateId') ?? ''), signedOn: String(formData.get('signedOn') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidate();
    return toActionState(result, t, t('finance.directDebit.mandate.activated'));
  });
}

export async function correctMandateAction(input: { mandateId: string; debtorName: string; iban: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#correctMandateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await correctMandate(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.directDebit.mandate.corrected'));
  });
}

export async function amendMandateAction(input: { mandateId: string; debtorName?: string; iban?: string; validFrom: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#amendMandateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await amendMandate(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.directDebit.mandate.amended'));
  });
}

export async function endMandateAction(input: { mandateId: string; endedOn: string; reason: 'debtor' | 'creditor' | 'superseded' }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#endMandateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endMandate(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.directDebit.mandate.ended'));
  });
}

// ── Zusage (Handoff 2a § 1.5) ───────────────────────────────────────────────

export async function savePledgeAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#savePledgeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await savePledge(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    const prepared = result.value.prenotificationDraftId !== null;
    return { status: 'success', message: t(prepared ? 'finance.directDebit.pledge.savedWithMandate' : 'finance.directDebit.pledge.saved'), data: { id: result.value.pledge.id } };
  });
}

export async function pausePledgeAction(input: { pledgeId: string; from: string; until: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#pausePledgeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await pausePledge(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.directDebit.pledge.paused'));
  });
}

export async function endPledgeAction(input: { pledgeId: string; endedOn: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/direct-debit/actions.ts#endPledgeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endPledge(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.directDebit.pledge.ended'));
  });
}
