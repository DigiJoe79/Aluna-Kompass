'use server';

import { bookFromTransaction, deleteDraft, linkTransactionToEntry, setReviewed } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import type { BookFromTransactionInput } from '@/lib/finance/work';
import { requireSession } from '@/lib/request-context';

/** Die Arbeitsliste und das Journal zeigen dieselben Entwürfe — beide neu lesen. */
function revalidateWork(): void {
  revalidatePath('/finance/work');
  revalidatePath('/finance/entries');
}

/** „Übernehmen und geprüft“ (`Enter`): ein Aufruf von `bookFromTransaction` mit `reviewed: true` (F5 Annahme 10). */
export async function bookFromTransactionAction(input: BookFromTransactionInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await bookFromTransaction(deps, ctx, { ...input, reviewed: true });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, result.value.status === 'final' ? t('finance.work.toast.bookedFinal', { number: result.value.number ?? '' }) : t('finance.work.toast.booked'));
}

/** „Dieser Umsatz passt zu Ihrer Buchung“ — Verknüpfen statt neu buchen. */
export async function linkTransactionAction(rawTransactionId: string, entryId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await linkTransactionToEntry(deps, ctx, { rawTransactionId, entryId });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.linked'));
}

/** Reiter „Vom Agenten vorbereitet“: ein Mensch prüft den Entwurf. */
export async function markReviewedAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setReviewed(deps, ctx, { id, reviewed: true });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.reviewed'));
}

export async function deleteWorkDraftAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteDraft(deps, ctx, { id });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.deleted'));
}
