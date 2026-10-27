'use server';

import { cancelHandover, countCashForHandover, fileHandoverProtocol, handoverDefaults, recordHandoverInterimReport, saveHandoverItems, startHandover, updateHandover, type HandoverItemKey } from '@kompass/module-finance';
import { displayName, getContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Amtsübergabe (Rechenschaft C2 Task 8, Board 13e). Jede ruft genau einen Dienst; Rechte
 * (`finance.setup`), Prüfung und Protokoll stehen dort.
 */
function revalidate(): void {
  revalidatePath('/finance/closing', 'layout');
}

/** Vorschlag für „Von“: wer laut Kontaktrolle am Übergabetag Schatzmeister ist, mit Namen (ohne `contacts.view` keiner). */
export async function handoverDefaultsAction(handoverOn: string): Promise<{ from: { id: string; name: string } | null }> {
  const { deps, ctx } = await requireSession();
  const result = await handoverDefaults(deps, ctx, { handoverOn });
  if (!result.ok || !result.value.fromContactId) return { from: null };
  const contact = await getContact(deps, ctx, result.value.fromContactId);
  return contact.ok ? { from: { id: contact.value.id, name: displayName(contact.value) } } : { from: null };
}

export async function startHandoverAction(input: { handoverOn: string; fromContactId: string; toContactId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#startHandoverAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startHandover(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { id: result.value.id } };
  });
}

export async function updateHandoverAction(input: { id: string; handoverOn: string; fromContactId: string; toContactId: string; expectedVersion: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#updateHandoverAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateHandover(deps, ctx, input);
    revalidate();
    return toActionState(result, t);
  });
}

export async function cancelHandoverAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#cancelHandoverAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await cancelHandover(deps, ctx, { id });
    revalidate();
    return toActionState(result, t);
  });
}

/** Schritt 1: den Kassenbericht bis zum Übergabetag als Zwischenbericht festhalten. */
export async function interimReportAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#interimReportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await recordHandoverInterimReport(deps, ctx, { id });
    revalidate();
    return toActionState(result, t);
  });
}

export interface HandoverCountInput {
  id: string;
  accountId: string;
  countedCents: number;
  counterOneContactId: string;
  counterTwoContactId: string;
  note?: string;
  denominations?: Record<string, number>;
}

/** Schritt 2: die Kasse am Übergabetag zählen, die neue Person ist Zeugin (Zähldialog der Kasse). */
export async function countCashForHandoverAction(input: HandoverCountInput): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#countCashForHandoverAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await countCashForHandover(deps, ctx, input);
    revalidate();
    revalidatePath('/finance/cash');
    return toActionState(result, t);
  });
}

export interface HandoverItemInput {
  id?: string;
  key: HandoverItemKey;
  label?: string | null;
  note?: string | null;
  checked: boolean;
}

/** Schritt 3: Punkte abhaken, mit Notiz, eigene dazu. */
export async function saveHandoverItemsAction(id: string, items: HandoverItemInput[], expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#saveHandoverItemsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveHandoverItems(deps, ctx, { id, items, expectedVersion });
    revalidate();
    return toActionState(result, t);
  });
}

/** Schritt 3: den Scan des unterschriebenen Protokolls ablegen. */
export async function fileProtocolAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/closing/handover/actions.ts#fileProtocolAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileHandoverProtocol(deps, ctx, { id: String(formData.get('id') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidate();
    return toActionState(result, t);
  });
}
