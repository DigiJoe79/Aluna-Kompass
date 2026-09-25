'use server';

import type { Result } from '@kompass/core';
import { saveExpenseDraft, submitExpenseClaim, uploadExpenseReceipt } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import type { ExpenseDraftInput } from '@/lib/finance/expenses';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Auslagen (F8a). Ein Finanzfehler bringt Grund und
 * Abhilfe schon als Satz mit — der geht hier ungekürzt als `message` zurück
 * (die Kürzung von `toActionState` am ersten Doppelpunkt schnitte etwa die
 * Namen in „Das kann erledigen: …“ ab).
 */
async function finish<T>(result: Result<T>): Promise<ActionState> {
  const t = await getTranslations();
  if (!result.ok && result.error.type === 'conflict' && result.error.code !== 'staleVersion') {
    return { status: 'error', message: result.error.message, fieldErrors: {}, code: result.error.code };
  }
  return toActionState(result, t);
}

/** Laufende Sicherung — ohne `revalidatePath`: Die Seite soll beim Tippen nicht neu gezeichnet werden. */
export async function saveExpenseDraftAction(input: ExpenseDraftInput): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  return finish(await saveExpenseDraft(deps, ctx, input));
}

export async function uploadExpenseReceiptAction(claimId: string, positionId: string, fileName: string, bytes: Uint8Array): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  return finish(await uploadExpenseReceipt(deps, ctx, { claimId, positionId, fileName, bytes }));
}

export async function submitExpenseClaimAction(id: string, expectedVersion: string | null): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await submitExpenseClaim(deps, ctx, { id, ...(expectedVersion ? { expectedVersion } : {}) });
  if (result.ok) revalidatePath('/finance/expenses');
  return finish(result);
}
