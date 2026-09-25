'use server';

import { attachSignedConfirmation, checkConfirmable, getInKindDetails, issueConfirmation, recordConfirmationDispatch, saveInKindDetails, voidConfirmation } from '@kompass/module-finance';
import { getDocumentRecord } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Zuwendungsbestätigungen (F6a Task 7). Jede ruft genau
 * einen Dienst des Finanzmoduls; Prüfung, Rechte und Protokoll stehen dort.
 * Die Buchungsansicht zeigt den Abschnitt „Bestätigung“ — deshalb wird auch
 * `/finance/entries` neu aufgebaut.
 */
function revalidate(): void {
  revalidatePath('/finance/donations');
  revalidatePath('/finance/entries');
}

/** Die Prüfliste für den Ausstellen-Dialog, dazu die Angaben zur Sachspende, falls es eine ist. */
export async function loadIssueCheckAction(lineIds: string[], issuedOn: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const check = await checkConfirmable(deps, ctx, { lineIds, issuedOn });
  if (!check.ok) return toActionState(check, t);
  const details = check.value.kind === 'inKind' && lineIds[0] ? await getInKindDetails(deps, ctx, { lineId: lineIds[0] }) : null;
  return { status: 'success', data: { check: check.value, inKindDetails: details?.ok ? details.value : null } };
}

export interface InKindDetailsInput {
  lineId: string;
  item: string;
  condition: string;
  valuation: string;
  origin: 'private' | 'business';
  withdrawalValueCents?: number | null;
  vatCents?: number | null;
  proofDocumentId?: string | null;
}

export async function saveInKindDetailsAction(input: InKindDetailsInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveInKindDetails(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.inKind.toast.saved'));
}

export async function issueConfirmationAction(input: { lineIds: string[]; issuedOn: string }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await issueConfirmation(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.issue.toast.issued', { number: result.value.documentNumber }));
}

export interface VoidConfirmationInput {
  id: string;
  note: string;
  alreadySent: boolean;
  originalReturnedOn?: string;
  taxOfficeInformedOn?: string;
}

export async function voidConfirmationAction(input: VoidConfirmationInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await voidConfirmation(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.void.toast.done', { number: result.value.documentNumber }));
}

export async function recordDispatchAction(input: { id: string; sentAt: string; sentVia: 'post' | 'email' | 'handed' }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await recordConfirmationDispatch(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.dispatch.toast.done', { number: result.value.documentNumber }));
}

/** Vierschritt, Schritt 3: die unterschriebene Fassung als Eingang ablegen und verknüpfen. */
export async function attachSignedAction(id: string, fileName: string, bytes: Uint8Array): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await attachSignedConfirmation(deps, ctx, { id, bytes, fileName });
  revalidate();
  if (!result.ok) return toActionState(result, t);
  // Die Nummer der abgelegten Fassung liest nur, wer die Akte sehen darf — sonst kommt die Rückmeldung ohne sie.
  const record = result.value.signedDocumentId ? await getDocumentRecord(deps, ctx, result.value.signedDocumentId) : null;
  const number = record?.ok ? record.value.number : null;
  return toActionState(result, t, number ? t('finance.donations.signature.toast.done', { number }) : t('finance.donations.signature.toast.doneWithoutNumber'));
}
