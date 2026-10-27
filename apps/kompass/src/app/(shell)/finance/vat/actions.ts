'use server';

import { fileVatFilingDocument, linkVatFilingDocument, updateVatFiling, type VatFilingDocumentSlot } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Seite „Umsatzsteuer-Voranmeldung“ (Plan E6b Task 8). Eintragen der Abgabe über
 * `recordVatFilingAction` (Fristen); hier Tag ändern und Dokumente der Abgabe ablegen oder verknüpfen — Rechte, Prüfung und Protokoll
 * stehen im Dienst.
 */
function revalidate(): void {
  revalidatePath('/finance/vat');
  revalidatePath('/finance/deadlines');
  revalidatePath('/');
}

/** Den Tag der letzten Abgabe eines Zeitraums ändern. */
export async function updateVatFilingAction(filingId: string, filedOn: string): Promise<ActionState> {
  return guardAction('(shell)/finance/vat/actions.ts#updateVatFilingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateVatFiling(deps, ctx, { filingId, filedOn });
    revalidate();
    return toActionState(result, t);
  });
}

/** Ein PDF (ELSTER-Protokoll oder abgegebene Fassung) an der Abgabe ablegen. */
export async function fileVatFilingDocumentAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/vat/actions.ts#fileVatFilingDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileVatFilingDocument(deps, ctx, { filingId: String(formData.get('filingId') ?? ''), slot: String(formData.get('slot') ?? '') as VatFilingDocumentSlot, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    return toActionState(result, t);
  });
}

/** Ein Dokument der Akte als abgegebene Fassung oder ELSTER-Protokoll an die Abgabe legen (Plan E9 Task 1). */
export async function linkVatFilingDocumentAction(input: { filingId: string; slot: VatFilingDocumentSlot; documentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/vat/actions.ts#linkVatFilingDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkVatFilingDocument(deps, ctx, input);
    revalidate();
    return toActionState(result, t);
  });
}
