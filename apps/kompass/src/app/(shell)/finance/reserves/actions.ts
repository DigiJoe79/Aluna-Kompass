'use server';

import { guardAction } from '@/lib/action-guard';
import { deleteReserve, linkResolution, recordReserveCarryForward, recordReserveMovement, saveReserve, setReserveActive, uploadResolution } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { actionState } from '@/lib/action-state';
import type { ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * F8b Task 6b (Annahme 1, 2, 11) — E4 „Zurückgelegtes Geld“: Stammsatz
 * anlegen (`finance.setup`) und Vorgänge erfassen (`finance.entriesWrite`),
 * der Beschluss jeweils aus der Akte gewählt oder als PDF hochgeladen — nie
 * beides. Uploads nur als `File` in `FormData`.
 */
async function uploadFrom(formData: FormData): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name };
}

async function uploadFailed(): Promise<ActionState> {
  const t = await getTranslations();
  return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
}

export interface ReserveFormInput {
  kind: 'projectFunds' | 'replacement' | 'free' | 'participation';
  name: string;
  purposeText: string | null;
  purposeId: string | null;
}

/** Stammsatz, Auswahlweg. */
export async function saveReserveAction(input: ReserveFormInput & { resolutionDocumentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#saveReserveAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await saveReserve(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

/** Stammsatz, Uploadweg. */
export async function saveReserveUploadAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#saveReserveUploadAction', async () => {
    const { deps, ctx } = await requireSession();
    const upload = await uploadFrom(formData);
    if (!upload) return uploadFailed();
    const result = await saveReserve(deps, ctx, {
      kind: String(formData.get('kind') ?? ''),
      name: String(formData.get('name') ?? ''),
      purposeText: (formData.get('purposeText') as string) || null,
      purposeId: (formData.get('purposeId') as string) || null,
      resolutionUpload: upload,
    });
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

export interface MovementFormInput {
  reserveId: string;
  kind: 'allocate' | 'withdraw' | 'dissolve';
  movementDate: string;
  amountCents?: number;
  forFiscalYearId?: string;
  note: string | null;
  /** Befund S: Begründung über dem Höchstbetrag der freien Rücklage. */
  capReason?: string;
}

/** Vorgang, Auswahlweg. */
export async function recordReserveMovementAction(input: MovementFormInput & { resolutionDocumentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#recordReserveMovementAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await recordReserveMovement(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

/** Vorgang, Uploadweg. */
export async function recordReserveMovementUploadAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#recordReserveMovementUploadAction', async () => {
    const { deps, ctx } = await requireSession();
    const upload = await uploadFrom(formData);
    if (!upload) return uploadFailed();
    const amount = formData.get('amountCents');
    const result = await recordReserveMovement(deps, ctx, {
      reserveId: String(formData.get('reserveId') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      movementDate: String(formData.get('movementDate') ?? ''),
      amountCents: amount ? Number(amount) : undefined,
      forFiscalYearId: (formData.get('forFiscalYearId') as string) || undefined,
      note: (formData.get('note') as string) || null,
      capReason: (formData.get('capReason') as string) || undefined,
      resolutionUpload: upload,
    });
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

// ── Stammsatz im Zeilenmenü (Design-Nachtrag Phase 4, Befund 40) ─────────────

/** Der vollständige Stammsatz, wie `saveReserve` ihn beim Ändern erwartet — Vortrag und Aktiv-Schalter reisen mit, sonst setzte das Speichern sie zurück. */
export interface ReserveUpdateInput extends ReserveFormInput {
  id: string;
  expectedVersion: string;
  carryForwardCents: number | null;
  carryForwardDate: string | null;
  isActive: boolean;
}

/** Bearbeiten (`finance.setup`). */
export async function updateReserveAction(input: ReserveUpdateInput): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#updateReserveAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await saveReserve(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

/**
 * Beschluss ersetzen oder Vortragsbeschluss anhängen: aus der Akte gewählt
 * (`documentId`) oder als PDF hochgeladen (`file`) — nie beides.
 */
async function attachDocument(formData: FormData, field: 'resolution' | 'carryForward'): Promise<ActionState | null> {
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const documentId = (formData.get('documentId') as string) || null;
  if (documentId) {
    const linked = await linkResolution(deps, ctx, { id, field, documentId });
    return linked.ok ? null : actionState(linked);
  }
  const upload = await uploadFrom(formData);
  if (!upload) return uploadFailed();
  const uploaded = await uploadResolution(deps, ctx, { id, field, ...upload });
  return uploaded.ok ? null : actionState(uploaded);
}

/** Beschluss ersetzen (`finance.entriesWrite`, wie `finance_reserve_resolution_link`). */
export async function replaceResolutionAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#replaceResolutionAction', async () => {
    const failed = await attachDocument(formData, 'resolution');
    revalidatePath('/finance/reserves');
    return failed ?? { status: 'success' };
  });
}

/**
 * Vortrag erfassen (`finance.setup`): Betrag, Stichtag und Beschluss in einem
 * Dienstaufruf und einer Transaktion (Teil C Task 2) — scheitert der Beschluss,
 * bleibt auch der Vortrag ungeändert. Ohne neuen Beschluss bleibt der schon
 * hinterlegte stehen; fehlt auch der, verweigert der Dienst.
 */
export async function carryForwardAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#carryForwardAction', async () => {
    const { deps, ctx } = await requireSession();
    const reserve = JSON.parse(String(formData.get('reserve') ?? '{}')) as ReserveUpdateInput;
    const documentId = (formData.get('documentId') as string) || undefined;
    const upload = documentId ? null : await uploadFrom(formData);
    const result = await recordReserveCarryForward(deps, ctx, {
      id: reserve.id,
      expectedVersion: reserve.expectedVersion,
      carryForwardCents: reserve.carryForwardCents,
      carryForwardDate: reserve.carryForwardDate,
      ...(documentId ? { documentId } : {}),
      ...(upload ? { upload } : {}),
    });
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

/** Stilllegen oder wieder aktivieren (`finance.setup`). */
export async function setReserveActiveAction(id: string, isActive: boolean, expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#setReserveActiveAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await setReserveActive(deps, ctx, { id, isActive, expectedVersion });
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}

/** Löschen (`finance.setup`) — nur ohne Vorgänge und ohne Vortrag; sonst nennt die Meldung den Grund. */
export async function deleteReserveAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/reserves/actions.ts#deleteReserveAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await deleteReserve(deps, ctx, { id });
    if (result.ok) revalidatePath('/finance/reserves');
    return actionState(result);
  });
}
