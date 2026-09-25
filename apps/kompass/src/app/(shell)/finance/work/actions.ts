'use server';

import {
  applyInvoiceToDraft,
  attachDocument,
  attachVoucherToTransaction,
  createOpenItemFromInvoice,
  invoiceProposal,
  readInvoiceFromDocument,
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
  type InvoiceProposal,
  type VoucherSearchHit,
} from '@kompass/module-finance';
import { displayName } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
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

/**
 * „Übernehmen und geprüft“ (`Enter`): ein Aufruf von `bookFromTransaction` mit
 * `reviewed: true` (F5 Annahme 10). Kommt der Umsatz aus der Karte „Aus der
 * Rechnung“ (`?voucher=`), übernimmt `applyInvoiceToDraft` danach Lieferant,
 * Nummer, Kontakt und Steuer und hängt das PDF an; weil jedes Speichern eines
 * Entwurfs die Prüfung zurücksetzt, markiert `setReviewed` ihn wieder als
 * geprüft. Ist die Buchung gleich festgeschrieben (Barkonto), kommt nur der
 * Beleg dazu. Drei Dienste nacheinander — jeder prüft und protokolliert selbst.
 */
export async function bookFromTransactionAction(input: BookFromTransactionInput, invoiceDocumentId?: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await bookFromTransaction(deps, ctx, { ...input, reviewed: true });
  if (!result.ok || !invoiceDocumentId) {
    revalidateWork();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, result.value.status === 'final' ? t('finance.work.toast.bookedFinal', { number: result.value.number ?? '' }) : t('finance.work.toast.booked'));
  }
  const invoice = await readInvoiceFromDocument(deps, ctx, { documentId: invoiceDocumentId });
  const number = invoice.ok && invoice.value ? invoice.value.invoiceNumber : '';
  if (result.value.status === 'final') {
    const attached = await attachDocument(deps, ctx, { entryId: result.value.id, documentId: invoiceDocumentId });
    revalidateWork();
    if (!attached.ok) return toActionState(attached, t);
    return toActionState(attached, t, t('finance.work.toast.bookedFinal', { number: result.value.number ?? '' }));
  }
  const applied = await applyInvoiceToDraft(deps, ctx, { entryId: result.value.id, documentId: invoiceDocumentId });
  if (!applied.ok) {
    revalidateWork();
    return toActionState(applied, t);
  }
  const reviewed = await setReviewed(deps, ctx, { id: applied.value.id, reviewed: true, expectedVersion: applied.value.updatedAt });
  revalidateWork();
  if (!reviewed.ok) return toActionState(reviewed, t);
  return toActionState(reviewed, t, t('finance.work.toast.bookedWithInvoice', { number }));
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

/** Was die Arbeitsliste nach dem Ablegen über eine elektronische Rechnung im PDF anbietet (F5b). */
export interface UploadedInvoiceOffer {
  entryId: string;
  documentId: string;
  /** „{Lieferant}, {Nummer}, {Betrag}“ — vom Server gebildet, der Client zeigt nur. */
  summary: string;
}

/**
 * Ein PDF auf den Umsatz: `attachVoucherToTransaction` legt es im Namen der
 * Buchung ab (und legt den Entwurf an, wenn keiner da ist). Steckt im PDF eine
 * Rechnung in Euro, liefert die Antwort das Angebot „Angaben aus der Rechnung
 * übernehmen“ und die Liste wird noch **nicht** neu gelesen — sonst
 * verschwände der Umsatz samt Angebot, bevor jemand es annehmen kann.
 */
export async function uploadVoucherToTransactionAction(input: { rawTransactionId: string; typeKey: string; documentDate: string; title?: string; entryTextIfNew?: string; bytes: Uint8Array }): Promise<ActionState & { invoice?: UploadedInvoiceOffer }> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await attachVoucherToTransaction(deps, ctx, input);
  if (!result.ok) {
    revalidateWork();
    return toActionState(result, t);
  }
  const message = t('finance.work.toast.voucherUploaded', { number: result.value.voucher.documentNumber });
  const read = await readInvoiceFromDocument(deps, ctx, { documentId: result.value.voucher.documentId });
  const invoice = read.ok ? read.value : null;
  if (!invoice || invoice.currency !== 'EUR') {
    revalidateWork();
    return toActionState(result, t, message);
  }
  return {
    ...toActionState(result, t, message),
    invoice: {
      entryId: result.value.entryId,
      documentId: result.value.voucher.documentId,
      summary: t('finance.work.invoice.offerSummary', { seller: invoice.sellerName, number: invoice.invoiceNumber, amount: formatEuro(invoice.grandTotalCents) }),
    },
  };
}

/** „Angaben aus der Rechnung übernehmen“ im Belegbereich der Arbeitsliste. */
export async function applyInvoiceToDraftAction(entryId: string, documentId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await applyInvoiceToDraft(deps, ctx, { entryId, documentId });
  revalidateWork();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.work.invoice.applied'));
}

/** „Ohne Angaben weiter“: nur neu lesen, was das Ablegen verändert hat. */
export async function refreshWorkAction(): Promise<void> {
  await requireSession();
  revalidateWork();
}

/** Die Karte „Aus der Rechnung“ auf Abruf — liest nur, protokolliert nichts. */
export async function invoiceProposalAction(documentId: string): Promise<{ ok: true; proposal: InvoiceProposal } | { ok: false; message: string }> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await invoiceProposal(deps, ctx, { documentId });
  if (result.ok) return { ok: true, proposal: result.value };
  const state = toActionState(result, t);
  return { ok: false, message: state.status === 'error' ? (state.detail ?? state.message) : '' };
}

/** „Offene Zahlung anlegen“ aus der Karte: Betrag, Fälligkeit, Nummer und Beleg kommen aus der Rechnung. */
export async function createOpenItemFromInvoiceAction(input: { documentId: string; contactId?: string | null }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createOpenItemFromInvoice(deps, ctx, input);
  revalidateWork();
  revalidatePath('/finance/open-items');
  revalidatePath('/dms/[id]', 'page');
  if (!result.ok) return toActionState(result, t);
  return toActionState({ ok: true, value: { id: result.value.id, kind: result.value.kind } }, t, t('finance.work.invoice.openItemCreated'));
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
