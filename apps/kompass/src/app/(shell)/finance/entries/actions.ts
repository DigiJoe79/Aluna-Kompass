'use server';

import { guardAction } from '@/lib/action-guard';
import { guardConstraint, listUserNamesWithPermission, todayIn } from '@kompass/core';
import { attachDocument, bookEntry, deleteDraft, finalizeEntry, finalizeReviewed, listEntries, markNotReturn, requestAllocationCorrection, reverseEntry, revokeVoucher, saveDraft, setReviewed, uploadVoucher, type EntryLinesInput } from '@kompass/module-finance';
import { receiveGeneratedUpload } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';

/** Speichert (oder ersetzt) den Entwurf. Erfolg trägt `id` und `expectedVersion` in `data`, fürs Weiterarbeiten ohne Neuladen. */
export async function saveDraftAction(input: EntryLinesInput): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#saveDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveDraft(deps, ctx, input);
    revalidatePath('/finance/entries');
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.entryForm.toast.draftSaved'));
  });
}

/** `saveDraft` + `setReviewed`. */
export async function saveReviewedAction(input: EntryLinesInput): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#saveReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const draft = await saveDraft(deps, ctx, input);
    if (!draft.ok) return toActionState(draft, t);
    const reviewed = await setReviewed(deps, ctx, { id: draft.value.id, reviewed: true });
    revalidatePath('/finance/entries');
    if (!reviewed.ok) return toActionState(reviewed, t);
    return toActionState(reviewed, t, t('finance.entryForm.toast.reviewedSaved'));
  });
}

/** Entwurf vorhanden: `saveDraft` + `finalizeEntry` (ein Bearbeiten kurz vor dem Festschreiben zählt noch). Sonst `bookEntry` — der einzige Weg für Bargeld. */
export async function finalizeAction(input: EntryLinesInput): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#finalizeAction', async () => {
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
    // Befund 25: keine Sperre, nur ein Hinweis — angehängt an die übliche Erfolgsmeldung.
    const alert = result.value.notices.includes('cashDonationAboveAlert') ? ` ${t('finance.entryForm.toast.cashDonationAboveAlert')}` : '';
    // Befund AI: über der Jahresgrenze einer Pauschale — eine Warnung, keine Sperre.
    const exceeded = (result.value.allowanceExceeded ?? [])
      .map((e) => ` ${t('finance.entryForm.toast.allowanceExceeded', { person: e.contactName, amount: formatEuro(e.overCents), allowance: t(`finance.people.card.${e.kind}`), year: String(e.year) })}`)
      .join('');
    // N2: Rückgabe auf einer Spenden-Kategorie ohne Bezug — ein Hinweis, keine Sperre.
    const returnHint = result.value.notices.includes('returnWithoutOrigin') ? ` ${t('finance.entryForm.toast.returnWithoutOrigin')}` : '';
    return toActionState(result, t, `${t('finance.entryForm.toast.finalized', { number: result.value.number ?? '' })}${alert}${exceeded}${returnHint}`);
  });
}

/** `FormData` statt eines Uint8Array-Arguments (N9) — sonst scheitert der Upload ab rund 1 MB stumm. */
export async function uploadVoucherAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#uploadVoucherAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const entryId = String(formData.get('entryId') ?? '');
    const typeKey = String(formData.get('typeKey') ?? '');
    const documentDate = String(formData.get('documentDate') ?? '');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadVoucher(deps, ctx, { entryId, typeKey, documentDate, title: file.name, bytes });
    revalidatePath('/finance/entries');
    // Befund Z: dieselbe Datei liegt schon in der Akte — abgelegt ist trotzdem, der Hinweis nennt die Nummer.
    const numbers = result.ok ? (result.value.duplicateOf ?? []).map((d) => d.number ?? d.documentId).join(', ') : '';
    return toActionState(result, t, numbers && result.ok ? t('finance.work.toast.voucherDuplicate', { number: result.value.documentNumber, numbers }) : undefined);
  });
}

export async function attachDocumentAction(entryId: string, documentId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#attachDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await attachDocument(deps, ctx, { entryId, documentId });
    revalidatePath('/finance/entries');
    return toActionState(result, t);
  });
}

export async function setReviewedAction(id: string, reviewed: boolean): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#setReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setReviewed(deps, ctx, { id, reviewed });
    revalidatePath('/finance/entries');
    return toActionState(result, t);
  });
}

/** Sammellauf über mehrere Buchungen; jede einzeln, damit ein Feld weiß, welche gescheitert ist. */
export async function setReviewedManyAction(ids: string[], reviewed: boolean): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#setReviewedManyAction', async () => {
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
  });
}

export async function finalizeReviewedAction(ids: string[]): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#finalizeReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await finalizeReviewed(deps, ctx, { ids });
    revalidatePath('/finance/entries');
    if (!result.ok) return toActionState(result, t);
    const numbers = result.value.entries.map((e) => e.number).filter((n): n is string => !!n);
    return toActionState(result, t, t('finance.journal.toast.finalized', { numbers: numbers.join(', ') }));
  });
}

/** Der Kopfknopf „Geprüfte festschreiben (m)“: nimmt alle geprüften Entwürfe, nicht nur die sichtbare Seite. */
export async function finalizeAllReviewedAction(): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#finalizeAllReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    // Seitenweise: `listEntries` liefert höchstens 200 je Aufruf (vorher `limit: 500` — scheiterte immer an der Validierung).
    const ids: string[] = [];
    for (let offset = 0; ; offset += 200) {
      const reviewed = await listEntries(deps, ctx, { state: 'reviewed', limit: 200, offset });
      if (!reviewed.ok) return toActionState(reviewed, t);
      ids.push(...reviewed.value.entries.map((e) => e.id));
      if (offset + 200 >= reviewed.value.total) break;
    }
    if (ids.length === 0) return { status: 'success' };
    const result = await finalizeReviewed(deps, ctx, { ids });
    revalidatePath('/finance/entries');
    if (!result.ok) return toActionState(result, t);
    const numbers = result.value.entries.map((e) => e.number).filter((n): n is string => !!n);
    return toActionState(result, t, t('finance.journal.toast.finalized', { numbers: numbers.join(', ') }));
  });
}

export interface CorrectionChanges {
  contactId?: string | null;
  projectId?: string | null;
  purposeId?: string | null;
  abroad?: boolean;
}

/** Zuordnung ändern (offenes Jahr: sofort; abgeschlossenes: wartet auf Freigabe — nennt dann, wer freigeben kann). */
export async function requestCorrectionAction(lineId: string, changes: CorrectionChanges, note: string, proofDocumentId?: string, acknowledgeSection153?: boolean, purposeReason?: string): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#requestCorrectionAction', async () => {
    const t = await getTranslations();
    const { deps, ctx, user } = await requireSession();
    const result = await requestAllocationCorrection(deps, ctx, { lineId, changes, note, proofDocumentId, acknowledgeSection153, purposeReason });
    revalidatePath('/finance/entries');
    if (!result.ok) return toActionState(result, t);
    if (result.value.applied) return toActionState(result, t, t('finance.entryView.correct.toast.applied'));
    const approvers = listUserNamesWithPermission(deps, 'finance.approve').filter((name) => name !== user.name);
    const message = approvers.length > 0 ? t('finance.entryView.correct.toast.pendingWithNames', { names: approvers.join(', ') }) : t('finance.entryView.correct.toast.pending');
    return toActionState(result, t, message);
  });
}

/**
 * Nachweisdokument für eine Zweckänderung im Namen der Buchung ablegen — wie
 * `uploadVoucherAction`, aber **ohne** es als Beleg zu verknüpfen: Das
 * übernimmt `requestAllocationCorrection` selbst, sobald die Korrektur die
 * `documentId` als `proofDocumentId` mitbekommt (sonst hinge das Dokument
 * doppelt an der Buchung).
 */
export async function uploadCorrectionProofAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#uploadCorrectionProofAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const entryId = String(formData.get('entryId') ?? '');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const documentDate = todayIn(deps);
    const result = await receiveGeneratedUpload(deps, ctx, {
      bytes,
      typeKey: 'voucher-own',
      subject: file.name,
      documentDate,
      links: [{ entityType: 'financeEntry', entityId: entryId }],
    });
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { documentId: result.value.document.id } };
  });
}

/** Buchung zurücknehmen: Gegenbuchung, sofort festgeschrieben. */
export async function reverseEntryAction(id: string, withCorrectionDraft: boolean, cashWarningReason?: string): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#reverseEntryAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reverseEntry(deps, ctx, { id, withCorrectionDraft, cashWarningReason });
    revalidatePath('/finance/entries');
    return toActionState(result, t);
  });
}

export async function revokeVoucherAction(linkId: string, note: string, replacementDocumentId?: string): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#revokeVoucherAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await revokeVoucher(deps, ctx, { linkId, note, replacementDocumentId });
    revalidatePath('/finance/entries');
    return toActionState(result, t);
  });
}

export async function deleteDraftsAction(ids: string[]): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#deleteDraftsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    for (const id of ids) {
      const result = await guardConstraint('action deleteDraft', () => deleteDraft(deps, ctx, { id }));
      if (!result.ok) {
        revalidatePath('/finance/entries');
        return toActionState(result, t);
      }
    }
    revalidatePath('/finance/entries');
    return { status: 'success' };
  });
}

/** AC: Auszahlung ist keine Rückgabe (mit Begründung) — oder die Kennzeichnung aufheben. */
export async function markNotReturnAction(input: { entryId: string; notReturn: boolean; note?: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/entries/actions.ts#markNotReturnAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markNotReturn(deps, ctx, input);
    revalidatePath('/finance/entries');
    revalidatePath('/finance/donations');
    return toActionState(result, t, t(input.notReturn ? 'finance.entryView.notReturn.toastMarked' : 'finance.entryView.notReturn.toastLifted'));
  });
}
