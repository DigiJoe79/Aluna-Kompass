'use server';

import type { Result } from '@kompass/core';
import {
  approveExpenseClaim,
  attachSignedWaiver,
  copyExpenseClaim,
  createWaiverDeclaration,
  deleteExpenseDraft,
  rejectExpenseClaim,
  saveExpenseDraft,
  submitExpenseClaim,
  uploadExpenseReceipt,
  waiverChecks,
} from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import type { ApproveInput, ExpenseDraftInput } from '@/lib/finance/expenses';
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

export async function uploadExpenseReceiptAction(formData: FormData): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    const t = await getTranslations();
    return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
  }
  const claimId = String(formData.get('claimId') ?? '');
  const positionId = String(formData.get('positionId') ?? '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return finish(await uploadExpenseReceipt(deps, ctx, { claimId, positionId, fileName: file.name, bytes }));
}

export async function submitExpenseClaimAction(id: string, expectedVersion: string | null): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await submitExpenseClaim(deps, ctx, { id, ...(expectedVersion ? { expectedVersion } : {}) });
  if (result.ok) revalidatePath('/finance/expenses');
  return finish(result);
}

// ── D2 „Eigene Anträge“ ─────────────────────────────────────────────────────

/** „Neu einreichen“: der abgelehnte Antrag als Entwurf mit Verweis — die Oberfläche öffnet ihn im Formular. */
export async function copyExpenseClaimAction(id: string): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await copyExpenseClaim(deps, ctx, { id });
  if (result.ok) revalidatePath('/finance/expenses');
  return finish(result);
}

export async function deleteExpenseDraftAction(id: string): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await deleteExpenseDraft(deps, ctx, { id });
  if (result.ok) revalidatePath('/finance/expenses');
  return finish(result);
}

// ── D3 „Freigaben“ ──────────────────────────────────────────────────────────

const revalidateApprovals = () => {
  revalidatePath('/finance/approvals');
  revalidatePath('/finance/expenses');
  revalidatePath('/finance/open-items');
};

/** Freigeben (humanOnly im Dienst): je Position die Kategorie, bei Verzicht die Angaben der vier Prüfungen. */
export async function approveExpenseClaimAction(input: ApproveInput): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await approveExpenseClaim(deps, ctx, input);
  if (result.ok) revalidateApprovals();
  return finish(result);
}

export async function rejectExpenseClaimAction(claimId: string, note: string): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await rejectExpenseClaim(deps, ctx, { claimId, note });
  if (result.ok) revalidateApprovals();
  return finish(result);
}

/** Die vier Prüfungen neu rechnen, wenn sich Verzichtstag oder Häkchen ändern — schreibt nichts. */
export async function waiverChecksAction(claimId: string, declaredOn: string, claimAgreedConfirmed: boolean): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  return finish(await waiverChecks(deps, ctx, { claimId, declaredOn, claimAgreedConfirmed }));
}

export async function createWaiverDeclarationAction(claimId: string, declaredOn: string): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const result = await createWaiverDeclaration(deps, ctx, { claimId, declaredOn });
  if (result.ok) revalidateApprovals();
  return finish(result);
}

export async function attachSignedWaiverAction(formData: FormData): Promise<ActionState> {
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    const t = await getTranslations();
    return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
  }
  const claimId = String(formData.get('claimId') ?? '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await attachSignedWaiver(deps, ctx, { claimId, bytes });
  if (result.ok) revalidateApprovals();
  return finish(result);
}
