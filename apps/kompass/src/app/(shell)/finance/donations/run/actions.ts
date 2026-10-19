'use server';

import { guardAction } from '@/lib/action-guard';
import { dispatchRunConfirmations, markRunPostConfirmations, moveConfirmationRunLetters, previewConfirmationRun, sendConfirmationRunEmails, startConfirmationRun } from '@kompass/module-finance';
import { resendDocumentEmail } from '@kompass/module-dms';
import { kickMailSender } from '@/lib/background';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions des Serienlaufs (F6b Task 7). Jede ruft genau einen Dienst
 * des Finanzmoduls; Auswahl, Prüfliste, Rechte und Protokoll stehen dort.
 * Fortgesetzt wird nicht hier, sondern über den Route Handler
 * `/finance/donations/run/[id]/continue` — Server Actions laufen seriell.
 */
export interface RunSelectionInput {
  year: number;
  minCents?: number;
  excludedContactIds?: string[];
  followUpOfRunId?: string;
}

function revalidate(): void {
  revalidatePath('/finance/donations');
  revalidatePath('/finance/donations/run');
  revalidatePath('/finance/entries');
}

/** Die Vorschau neu rechnen, wenn sich die Auswahl ändert — `finance.read`. */
export async function previewConfirmationRunAction(input: RunSelectionInput): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#previewConfirmationRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await previewConfirmationRun(deps, ctx, input), t);
  });
}

/** Den Lauf starten — `finance.donationsIssue`, nur ein Mensch. Ausgestellt wird danach über den Continue-Handler. */
export async function startConfirmationRunAction(input: RunSelectionInput): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#startConfirmationRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startConfirmationRun(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('finance.donations.run.toast.started'), data: { id: result.value.id } };
  });
}

/** Versandvermerk für alle maschinellen Bestätigungen des Laufs — ein Vermerk, kein Versand. */
export async function dispatchRunConfirmationsAction(input: { runId: string; sentAt: string; sentVia: 'post' | 'email' | 'handed' }): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#dispatchRunConfirmationsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await dispatchRunConfirmations(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('finance.donations.run.dispatch.toast') };
  });
}

/** „{n} per E-Mail senden“ im Schritt „Ergebnis“ (Handoff 2b E3) — `finance.donationsIssue` und `dms.send`, nur ein Mensch. */
export async function sendRunMailsAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#sendRunMailsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await sendConfirmationRunEmails(deps, ctx, { runId });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    kickMailSender();
    return { status: 'success', message: t('dispatchStep.sending', { count: result.value.queued }) };
  });
}

/** „Versand vermerken …“ an Zeilen der Post-Gruppe. */
export async function markRunPostAction(input: { runId: string; documentIds: string[]; sentAt: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#markRunPostAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markRunPostConfirmations(deps, ctx, input);
    revalidate();
    return toActionState(result, t);
  });
}

/** „Erneut senden“ an einer nicht zugestellten Zeile: eine neue Sendung, die alte bleibt im Ausgang. */
export async function resendRunMailAction(outboxId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#resendRunMailAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resendDocumentEmail(deps, ctx, { outboxId });
    if (result.ok) kickMailSender();
    revalidate();
    return toActionState(result, t, t('dispatchStep.resent'));
  });
}

/** „Per Post schicken“ / „Zurück zu E-Mail“ je Zeile des Versand-Schritts (Plan U4 Task 2). */
export async function moveRunLettersAction(input: { runId: string; documentIds: string[]; to: 'post' | 'email' }): Promise<ActionState> {
  return guardAction('(shell)/finance/donations/run/actions.ts#moveRunLettersAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveConfirmationRunLetters(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t(input.to === 'post' ? 'dispatchStep.movedToPost' : 'dispatchStep.movedToEmail'));
  });
}
