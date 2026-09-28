'use server';

import { guardAction } from '@/lib/action-guard';
import { approvePurposeTransfer, fulfillPurpose, purposeMovements, rejectPurposeTransfer, reopenPurpose, requestPurposeTransfer, type PurposeMovementLine } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { actionState } from '@/lib/action-state';
import type { ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * F8b Task 3/6a (Annahme 5, 7) — Freigeben/Ablehnen einer Umwidmung (gerufen
 * von der gemeinsamen Detailansicht unter `/finance/approvals?transfer=`)
 * sowie E3 selbst: Umwidmung anlegen (Auswahl oder Upload), erfüllen,
 * wieder öffnen. Eigene Datei je Route-Bündel (kein Import aus
 * `admin/finance/actions.ts`).
 */
export async function approvePurposeTransferAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#approvePurposeTransferAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await approvePurposeTransfer(deps, ctx, { id });
    if (result.ok) {
      revalidatePath('/finance/approvals');
      revalidatePath('/finance/purposes');
    }
    return actionState(result);
  });
}

export async function rejectPurposeTransferAction(id: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#rejectPurposeTransferAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await rejectPurposeTransfer(deps, ctx, { id, note });
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}

export interface TransferFormInput {
  fromPurposeId: string | null;
  toPurposeId: string | null;
  amountCents: number;
  transferDate: string;
  reason: string;
}

/** E5, Auswahlweg: ein bereits abgelegtes Dokument der Akte als Beschluss. */
export async function requestPurposeTransferAction(input: TransferFormInput & { documentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#requestPurposeTransferAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await requestPurposeTransfer(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/purposes');
    return actionState(result);
  });
}

/** E5, Uploadweg: ein PDF, im Namen der Umwidmung hochgeladen (nie beides). */
export async function requestPurposeTransferUploadAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#requestPurposeTransferUploadAction', async () => {
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      const t = await getTranslations();
      return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const amount = Number(formData.get('amountCents') ?? '0');
    const result = await requestPurposeTransfer(deps, ctx, {
      fromPurposeId: (formData.get('fromPurposeId') as string) || null,
      toPurposeId: (formData.get('toPurposeId') as string) || null,
      amountCents: amount,
      transferDate: String(formData.get('transferDate') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      documentUpload: { bytes, fileName: file.name },
    });
    if (result.ok) revalidatePath('/finance/purposes');
    return actionState(result);
  });
}

/** „Als erfüllt kennzeichnen“ (Designer-README 4c). */
export async function fulfillPurposeAction(id: string, expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#fulfillPurposeAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await fulfillPurpose(deps, ctx, { id, expectedVersion });
    if (result.ok) revalidatePath('/finance/purposes');
    return actionState(result);
  });
}

/** „Wieder öffnen …“ mit Pflicht-Begründung (Designer-README 4c, Annahme 7). */
export async function reopenPurposeAction(id: string, expectedVersion: string, reason: string): Promise<ActionState> {
  return guardAction('(shell)/finance/purposes/actions.ts#reopenPurposeAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await reopenPurpose(deps, ctx, { id, expectedVersion, reason });
    if (result.ok) revalidatePath('/finance/purposes');
    return actionState(result);
  });
}

/** Bewegungen eines Zwecks für die aufklappbare Zeile (nur `finance.read`, per Dienst geprüft). */
export async function purposeMovementsAction(purposeId: string): Promise<{ movements: PurposeMovementLine[] } | { error: string }> {
  const { deps, ctx } = await requireSession();
  const result = await purposeMovements(deps, ctx, { purposeId });
  if (!result.ok) {
    const state = await actionState(result);
    return { error: state.status === 'error' ? state.message : '' };
  }
  return { movements: result.value };
}
