'use server';

import { guardAction } from '@/lib/action-guard';
import {
  acknowledgeEvidence,
  addEvidenceLink,
  addEvidenceUpload,
  approvePartnerPayment,
  copyPartnerPayment,
  deletePartnerPaymentDraft,
  deletePartnerProfile,
  rejectPartnerPayment,
  removeEvidence,
  savePartnerNotice,
  savePartnerPaymentDraft,
  savePartnerProfile,
  setPartnerActive,
  submitPartnerPayment,
  updateEvidence,
  voidPartnerNotice,
} from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { actionState } from '@/lib/action-state';
import type { ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Wie bei den Auslagen: ein Finanzfehler trägt Grund und Abhilfe schon als ganzer Satz. */
const revalidatePartners = (partnerId?: string) => {
  revalidatePath('/finance/partners');
  if (partnerId) revalidatePath(`/finance/partners/${partnerId}`);
  revalidatePath('/finance/approvals');
};

export async function savePartnerProfileAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#savePartnerProfileAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await savePartnerProfile(deps, ctx, input);
    if (result.ok) revalidatePartners(result.value.id);
    return actionState(result);
  });
}

export async function setPartnerActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#setPartnerActiveAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await setPartnerActive(deps, ctx, { id, isActive });
    if (result.ok) revalidatePartners(id);
    return actionState(result);
  });
}

export async function deletePartnerProfileAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#deletePartnerProfileAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await deletePartnerProfile(deps, ctx, { id });
    if (result.ok) revalidatePartners();
    return actionState(result);
  });
}

export async function savePartnerNoticeAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#savePartnerNoticeAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await savePartnerNotice(deps, ctx, input);
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

export async function voidPartnerNoticeAction(id: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#voidPartnerNoticeAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await voidPartnerNotice(deps, ctx, { id, note });
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

// ── Zahlung an Partner ──────────────────────────────────────────────────────

export async function savePartnerPaymentDraftAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#savePartnerPaymentDraftAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await savePartnerPaymentDraft(deps, ctx, input);
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

export async function submitPartnerPaymentAction(id: string, expectedVersion: string, noticeReason?: string, overdueReason?: string, purposeReason?: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#submitPartnerPaymentAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await submitPartnerPayment(deps, ctx, { id, expectedVersion, noticeReason, overdueReason, purposeReason });
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

export async function deletePartnerPaymentDraftAction(id: string, partnerId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#deletePartnerPaymentDraftAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await deletePartnerPaymentDraft(deps, ctx, { id });
    if (result.ok) revalidatePartners(partnerId);
    return actionState(result);
  });
}

export async function copyPartnerPaymentAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#copyPartnerPaymentAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await copyPartnerPayment(deps, ctx, { id });
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

// ── Freigabe (D3, gemeinsame Detailansicht) ─────────────────────────────────

export async function approvePartnerPaymentAction(id: string, expectedVersion: string, noticeReason?: string, overdueReason?: string, purposeReason?: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#approvePartnerPaymentAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await approvePartnerPayment(deps, ctx, { id, expectedVersion, noticeReason, overdueReason, purposeReason });
    if (result.ok) {
      revalidatePartners(result.value.partnerId);
      revalidatePath('/finance/open-items');
    }
    return actionState(result);
  });
}

export async function rejectPartnerPaymentAction(id: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#rejectPartnerPaymentAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await rejectPartnerPayment(deps, ctx, { id, note });
    if (result.ok) revalidatePartners(result.value.partnerId);
    return actionState(result);
  });
}

// ── Nachweise ────────────────────────────────────────────────────────────────

export async function addEvidenceLinkAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#addEvidenceLinkAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await addEvidenceLink(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}

export async function addEvidenceUploadAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#addEvidenceUploadAction', async () => {
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      const t = await getTranslations();
      return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await addEvidenceUpload(deps, ctx, {
      paymentId: String(formData.get('paymentId') ?? ''),
      kind: String(formData.get('kind') ?? '') as never,
      foreignLanguage: formData.get('foreignLanguage') === 'on',
      explanationDe: (formData.get('explanationDe') as string) || undefined,
      coveredCents: formData.get('coveredCents') ? Math.round(Number(formData.get('coveredCents')) * 100) : undefined,
      bytes,
      fileName: file.name,
    });
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}

export async function updateEvidenceAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#updateEvidenceAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await updateEvidence(deps, ctx, input);
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}

export async function removeEvidenceAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#removeEvidenceAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await removeEvidence(deps, ctx, { id });
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}

export async function acknowledgeEvidenceAction(paymentId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/partners/actions.ts#acknowledgeEvidenceAction', async () => {
    const { deps, ctx } = await requireSession();
    const result = await acknowledgeEvidence(deps, ctx, { paymentId });
    if (result.ok) revalidatePath('/finance/approvals');
    return actionState(result);
  });
}
