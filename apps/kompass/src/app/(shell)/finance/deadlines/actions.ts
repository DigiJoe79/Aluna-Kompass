'use server';

import { completeFollowUp, createFollowUp, reopenFollowUp } from '@kompass/core';
import { recordVatFiling } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Seite „Fristen und Schwellen“ (Rechenschaft C2 Task 9, Board 6a). Wiedervorlagen über die
 * Dienste des Kerns (`followUps.manage`), die Abgabe der USt-Erklärung über die Finanzen (`finance.periodClose`).
 */
function revalidate(): void {
  revalidatePath('/finance/deadlines');
  revalidatePath('/');
}

export async function createFollowUpAction(input: { entityType: string; entityId: string; title: string; dueAt: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/deadlines/actions.ts#createFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createFollowUp(deps, ctx, input);
    revalidate();
    revalidatePath('/finance/donations/notices');
    return toActionState(result, t);
  });
}

export async function completeFollowUpAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/deadlines/actions.ts#completeFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await completeFollowUp(deps, ctx, { id });
    revalidate();
    return toActionState(result, t);
  });
}

export async function reopenFollowUpAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/deadlines/actions.ts#reopenFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reopenFollowUp(deps, ctx, { id });
    revalidate();
    return toActionState(result, t);
  });
}

/** E6a: der Tag der Abgabe einer Voranmeldung oder Jahreserklärung (`period`); danach verschwindet die Frist. */
export async function recordVatFilingAction(period: string, filedOn: string): Promise<ActionState> {
  return guardAction('(shell)/finance/deadlines/actions.ts#recordVatFilingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await recordVatFiling(deps, ctx, { period, filedOn });
    revalidate();
    revalidatePath('/finance/closing', 'layout');
    return toActionState(result, t);
  });
}
