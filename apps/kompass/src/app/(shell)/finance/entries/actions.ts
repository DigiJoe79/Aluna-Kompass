'use server';

import { deleteDraft, finalizeReviewed, listEntries, setReviewed } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function setReviewedAction(id: string, reviewed: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setReviewed(deps, ctx, { id, reviewed });
  revalidatePath('/finance/entries');
  return toActionState(result, t);
}

/** Sammellauf über mehrere Buchungen; jede einzeln, damit ein Feld weiß, welche gescheitert ist. */
export async function setReviewedManyAction(ids: string[], reviewed: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  for (const id of ids) {
    const result = await setReviewed(deps, ctx, { id, reviewed });
    if (!result.ok) {
      revalidatePath('/finance/entries');
      return toActionState(result, t);
    }
  }
  revalidatePath('/finance/entries');
  return { status: 'success' };
}

export async function finalizeReviewedAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await finalizeReviewed(deps, ctx, { ids });
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  const numbers = result.value.entries.map((e) => e.number).filter((n): n is string => !!n);
  return toActionState(result, t, t('finance.journal.toast.finalized', { numbers: numbers.join(', ') }));
}

/** Der Kopfknopf „Geprüfte festschreiben (m)“: nimmt alle geprüften Entwürfe, nicht nur die sichtbare Seite. */
export async function finalizeAllReviewedAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const reviewed = await listEntries(deps, ctx, { state: 'reviewed', limit: 500 });
  if (!reviewed.ok) return toActionState(reviewed, t);
  const ids = reviewed.value.entries.map((e) => e.id);
  if (ids.length === 0) return { status: 'success' };
  const result = await finalizeReviewed(deps, ctx, { ids });
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  const numbers = result.value.entries.map((e) => e.number).filter((n): n is string => !!n);
  return toActionState(result, t, t('finance.journal.toast.finalized', { numbers: numbers.join(', ') }));
}

export async function deleteDraftsAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  for (const id of ids) {
    const result = await deleteDraft(deps, ctx, { id });
    if (!result.ok) {
      revalidatePath('/finance/entries');
      return toActionState(result, t);
    }
  }
  revalidatePath('/finance/entries');
  return { status: 'success' };
}
