'use server';

import { attachDocument, bookEntry, deleteDraft, finalizeEntry, finalizeReviewed, listEntries, saveDraft, setReviewed, uploadVoucher, type EntryLinesInput } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Speichert (oder ersetzt) den Entwurf. Erfolg trägt `id` und `expectedVersion` in `data`, fürs Weiterarbeiten ohne Neuladen. */
export async function saveDraftAction(input: EntryLinesInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveDraft(deps, ctx, input);
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.entryForm.toast.draftSaved'));
}

/** `saveDraft` + `setReviewed`. */
export async function saveReviewedAction(input: EntryLinesInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const draft = await saveDraft(deps, ctx, input);
  if (!draft.ok) return toActionState(draft, t);
  const reviewed = await setReviewed(deps, ctx, { id: draft.value.id, reviewed: true });
  revalidatePath('/finance/entries');
  if (!reviewed.ok) return toActionState(reviewed, t);
  return toActionState(reviewed, t, t('finance.entryForm.toast.reviewedSaved'));
}

/** Entwurf vorhanden: `saveDraft` + `finalizeEntry` (ein Bearbeiten kurz vor dem Festschreiben zählt noch). Sonst `bookEntry` — der einzige Weg für Bargeld. */
export async function finalizeAction(input: EntryLinesInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  let result;
  if (input.id) {
    const draft = await saveDraft(deps, ctx, input);
    if (!draft.ok) return toActionState(draft, t);
    result = await finalizeEntry(deps, ctx, { id: draft.value.id });
  } else {
    result = await bookEntry(deps, ctx, input);
  }
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.entryForm.toast.finalized', { number: result.value.number ?? '' }));
}

export async function uploadVoucherAction(entryId: string, typeKey: string, documentDate: string, filename: string, bytes: Uint8Array): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await uploadVoucher(deps, ctx, { entryId, typeKey, documentDate, title: filename, bytes });
  revalidatePath('/finance/entries');
  return toActionState(result, t);
}

export async function attachDocumentAction(entryId: string, documentId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await attachDocument(deps, ctx, { entryId, documentId });
  revalidatePath('/finance/entries');
  return toActionState(result, t);
}

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
