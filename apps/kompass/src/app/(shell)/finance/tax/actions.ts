'use server';

import { checkReverseCharge, clearReverseChargeDecline, declineReverseCharge, type ReverseChargeDeclineReason, type ReverseChargePromptView, createTaxPeriod, fileTaxPeriodDocument, getContactTaxDetails, linkTaxPeriodDocument, linkTaxPeriodNotice, recordNameConsent, saveContactTaxDetails, saveTaxPeriodAnswers, updateTaxPeriod, type GemAnswers, type TaxPeriodDocumentSlot } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Seite „Steuererklärung“ (Rechenschaft D2, Board 5a, 10b, 13g, 15d–15i). Je eine Aktion je Dienst;
 * Rechte, Prüfung und Protokoll stehen dort. Neu aufgebaut werden auch Fristen, Jahresabschluss (Schritt 12) und
 * Berichte, die den Zeitraum lesen.
 */
function revalidate(): void {
  revalidatePath('/finance/tax');
  revalidatePath('/finance/deadlines');
  revalidatePath('/finance/closing');
  revalidatePath('/finance/reports', 'layout');
}

export interface TaxPeriodInput {
  id?: string;
  expectedVersion?: string;
  firstFiscalYearId?: string;
  lastFiscalYearId?: string;
  requestedOn?: string | null;
  withTaxAdvisor?: boolean;
  dueOn?: string;
  /** Nur „Abgabe bearbeiten …“: der Tag der Abgabe, `null` nimmt sie zurück; fehlt, bleibt er. */
  filedOn?: string | null;
}

/** Anlegen (ohne `id`) oder ändern. Leere Tage gehen als `null` bzw. fehlen, damit der Dienst „Pflichtfeld“ meldet. */
export async function saveTaxPeriodAction(input: TaxPeriodInput): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#saveTaxPeriodAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const { id, ...rest } = input;
    const result = id ? await updateTaxPeriod(deps, ctx, { id, ...rest }) : await createTaxPeriod(deps, ctx, rest);
    revalidate();
    return toActionState(result, t, t(id ? 'finance.tax.toast.saved' : 'finance.tax.toast.created'));
  });
}

export async function saveTaxPeriodAnswersAction(input: { id: string; answers: GemAnswers; expectedVersion?: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#saveTaxPeriodAnswersAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveTaxPeriodAnswers(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.tax.toast.answersSaved'));
  });
}

/**
 * Ein PDF auf einen Platz des Zeitraums ablegen. `FormData` statt eines Uint8Array-Arguments: React begrenzt
 * Typed-Array-Bytes in Server-Action-Argumenten auf rund 1 MB (Muster `donations/notices/actions.ts`).
 */
export async function fileTaxPeriodDocumentAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#fileTaxPeriodDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileTaxPeriodDocument(deps, ctx, { id: String(formData.get('id') ?? ''), slot: String(formData.get('slot') ?? '') as TaxPeriodDocumentSlot, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    return toActionState(result, t, t('finance.tax.toast.filed'));
  });
}

export async function linkTaxPeriodDocumentAction(input: { id: string; slot: TaxPeriodDocumentSlot; documentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#linkTaxPeriodDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkTaxPeriodDocument(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.tax.toast.filed'));
  });
}

export async function linkTaxPeriodNoticeAction(input: { id: string; noticeId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#linkTaxPeriodNoticeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkTaxPeriodNotice(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('finance.tax.toast.noticeLinked'));
  });
}

/** Steuerdaten von Empfänger oder Geber einer Vermögensausstattung (Zeilen 65, 70). */
export async function saveContactTaxDetailsAction(input: { contactId: string; taxOffice?: string; taxNumber?: string; beneficiaryPurpose?: string; reverseCharge?: 'eu' | 'other' | null; legalEntity?: 'yes' | 'no' | null }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#saveContactTaxDetailsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveContactTaxDetails(deps, ctx, input);
    revalidate();
    revalidatePath('/finance/partners', 'layout');
    return toActionState(result, t, t('finance.tax.toast.taxDetailsSaved'));
  });
}

/**
 * Jahresrechnung (U1 Task 7): Einwilligung zur Namensnennung erteilen oder widerrufen — ein neuer Eintrag im Verlauf
 * (`recordNameConsent`); nach einem Widerruf erneuert der Dienst die Webfassungen.
 */
export async function recordNameConsentAction(input: { contactId: string; kind: 'granted' | 'revoked'; on: string; fromYear?: number; documentId?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#recordNameConsentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await recordNameConsent(deps, ctx, input);
    revalidatePath(`/contacts/${input.contactId}`);
    return toActionState(result, t, t(input.kind === 'granted' ? 'finance.contactAnnualAccounts.dialog.grantDone' : 'finance.contactAnnualAccounts.dialog.revokeDone'));
  });
}

/**
 * E6a Task 11c: das Merkmal „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“ eines Kontakts — die Buchungsmaske setzt
 * damit das Kennzeichen einer Ausgabezeile ohne Kennzeichen. Ohne Recht oder ohne Angabe `null`.
 */
export async function contactReverseChargeAction(contactId: string): Promise<'eu' | 'other' | null> {
  const { deps, ctx } = await requireSession();
  const res = await getContactTaxDetails(deps, ctx, { contactId });
  return res.ok ? (res.value?.reverseCharge ?? null) : null;
}

/**
 * E6b Task 4: die Prüffrage § 13b für den Stand einer Maske (`checkReverseCharge`). Ohne Recht oder bei einer Ablehnung
 * `null` — die Prüffrage ist ein Hinweis und sperrt nichts.
 */
export async function checkReverseChargeAction(input: { contactId: string | null; documentId: string | null; rawTransactionId: string | null; lines: { amountCents: number; taxCode: string | null; categoryId?: string | null }[] }): Promise<ReverseChargePromptView | null> {
  const { deps, ctx } = await requireSession();
  const res = await checkReverseCharge(deps, ctx, input);
  return res.ok ? res.value.prompt : null;
}

/** E6b Task 4: „Nein, weil …“ am Kontakt merken. */
export async function declineReverseChargeAction(input: { contactId: string; reason: ReverseChargeDeclineReason; text?: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#declineReverseChargeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await declineReverseCharge(deps, ctx, input);
    revalidatePath(`/contacts/${input.contactId}`);
    return toActionState(result, t);
  });
}

/** E6b Task 4: „Wieder fragen“ am Kontakt. */
export async function clearReverseChargeDeclineAction(contactId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/tax/actions.ts#clearReverseChargeDeclineAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await clearReverseChargeDecline(deps, ctx, { contactId });
    revalidatePath(`/contacts/${contactId}`);
    return toActionState(result, t);
  });
}
