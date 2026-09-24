'use server';

import {
  attachDocument,
  attachVoucherToTransaction,
  bookFromTransaction,
  createContactFromTransaction,
  deleteDraft,
  deleteImportRule,
  getRawTransaction,
  linkTransactionToEntry,
  markTransactionForeign,
  previewBatchFinalize,
  previewImportRule,
  saveImportRule,
  searchVouchersForTransaction,
  setReviewed,
  type BatchFinalizePreview,
  type VoucherSearchHit,
} from '@kompass/module-finance';
import { displayName } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import type { BookFromTransactionInput } from '@/lib/finance/work';
import type { RuleConditionsInput, SaveImportRuleInput } from '@/lib/finance/work-dialogs';
import { requireSession } from '@/lib/request-context';

/** Die Arbeitsliste und das Journal zeigen dieselben Entwürfe — beide neu lesen. */
function revalidateWork(): void {
  revalidatePath('/finance/work');
  revalidatePath('/finance/work/foreign');
  revalidatePath('/finance/work/vouchers');
  revalidatePath('/finance/work/rules');
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

/** „Künftig immer so?“ und „Bearbeiten“ auf der Regeln-Seite: dieselbe Regel, derselbe Dienst. */
export async function saveImportRuleAction(input: SaveImportRuleInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveImportRule(deps, ctx, input);
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.ruleSaved'));
}

/** Live im Regel-Dialog: „trifft {n} frühere Umsätze, davon {m} anders gebucht“ — `null`, wenn der Dienst ablehnt. */
export async function previewImportRuleAction(input: RuleConditionsInput & { categoryId: string }): Promise<{ hitCount: number; differentlyBookedCount: number; differentlyBookedEntryIds: string[] } | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewImportRule(deps, ctx, input);
  return result.ok ? result.value : null;
}

export async function deleteImportRuleAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteImportRule(deps, ctx, { id });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.ruleDeleted'));
}

/** „Gehört nicht dem Verein“: ein Mensch entscheidet — geprüft wie „Übernehmen und geprüft“. */
export async function markForeignAction(input: { rawTransactionId: string; holder: string; returnsLineId?: string }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await markTransactionForeign(deps, ctx, { ...input, reviewed: true });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.foreign'));
}

export async function createContactFromTransactionAction(input: { rawTransactionId: string; kind: 'person' | 'organization'; firstName?: string; lastName?: string; name?: string }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createContactFromTransaction(deps, ctx, input);
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  const name = displayName(result.value.contact);
  return toActionState(result, t, t('finance.work.toast.contactCreated', { name }));
}

/** „Beleg suchen“: Treffer der Akte zum Kontoumsatz und die Suchbegriffe für „In der Akte suchen“. */
export async function searchVouchersAction(rawTransactionId: string): Promise<{ hits: VoucherSearchHit[]; queries: string[] } | null> {
  const { deps, ctx } = await requireSession();
  const result = await searchVouchersForTransaction(deps, ctx, { rawTransactionId });
  return result.ok ? result.value : null;
}

/**
 * „Verknüpfen“ an einem Treffer: Hängt schon eine Buchung am Umsatz, bekommt
 * sie den Beleg; sonst entsteht zuerst ein ungeprüfter Entwurf aus der
 * Mini-Maske (`bookFromTransaction`, `reviewed: false`). Zwei Dienste
 * nacheinander — jeder prüft und protokolliert selbst.
 */
export async function linkVoucherAction(rawTransactionId: string, documentId: string, draft: Omit<BookFromTransactionInput, 'reviewed'>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const raw = await getRawTransaction(deps, ctx, { id: rawTransactionId });
  if (!raw.ok) return toActionState(raw, t);
  let entryId = raw.value.entryId;
  if (!entryId) {
    const booked = await bookFromTransaction(deps, ctx, { ...draft, rawTransactionId, reviewed: false });
    if (!booked.ok) return toActionState(booked, t);
    entryId = booked.value.id;
  }
  const result = await attachDocument(deps, ctx, { entryId, documentId });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.voucherLinked', { number: result.value.documentNumber }));
}

/** Ein PDF auf den Umsatz: `attachVoucherToTransaction` legt es im Namen der Buchung ab (und legt den Entwurf an, wenn keiner da ist). */
export async function uploadVoucherToTransactionAction(input: { rawTransactionId: string; typeKey: string; documentDate: string; title?: string; entryTextIfNew?: string; bytes: Uint8Array }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await attachVoucherToTransaction(deps, ctx, input);
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.toast.voucherUploaded', { number: result.value.voucher.documentNumber }));
}

/** Sammel-Festschreiben vorschauen — alle geprüften Entwürfe, wie der Knopf danach sie festschreibt. */
export async function previewBatchFinalizeAction(): Promise<{ ok: true; preview: BatchFinalizePreview } | { ok: false; message: string }> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await previewBatchFinalize(deps, ctx, {});
  if (result.ok) return { ok: true, preview: result.value };
  const state = toActionState(result, t);
  return { ok: false, message: state.status === 'error' ? (state.detail ?? state.message) : '' };
}
