'use server';

import { completeRegisterFiling, createRegisterFiling, recordInterimOrder, resolveInterimOrder, saveTransparencyCheck, setFilingDocuments, updateRegisterFiling } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const revalidate = (id?: string) => {
  revalidatePath('/governance/register');
  revalidatePath('/governance');
  if (id) revalidatePath(`/governance/register/${id}`);
};
export async function createFilingAction(occasions: ({ id: string } | { termId: string } | { statuteId: string })[], note: string | null): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#createFilingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createRegisterFiling(deps, ctx, { occasions, ...(note ? { note } : {}) });
    revalidate();
    return toActionState(result, t, t('governance.register.created'));
  });
}

export async function updateFilingAction(id: string, patch: { notaryContactId?: string | null; notarizedOn?: string | null; submittedOn?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#updateFilingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateRegisterFiling(deps, ctx, { id, ...patch });
    revalidate(id);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

/** „Neue Unterschrift beim Notar …“: Beglaubigung neu und die offene Zwischenverfügung erledigt. */
export async function renotarizeAction(id: string, notarizedOn: string, index: number): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#renotarizeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const updated = await updateRegisterFiling(deps, ctx, { id, notarizedOn });
    const result = updated.ok ? await resolveInterimOrder(deps, ctx, { filingId: id, index, resolvedOn: notarizedOn }) : updated;
    revalidate(id);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

export async function interimOrderAction(input: { filingId: string; on: string; deadline?: string; documentId?: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#interimOrderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await recordInterimOrder(deps, ctx, input);
    revalidate(input.filingId);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

export async function resolveInterimAction(filingId: string, index: number, resolvedOn: string): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#resolveInterimAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resolveInterimOrder(deps, ctx, { filingId, index, resolvedOn });
    revalidate(filingId);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

export async function setFilingDocumentsAction(filingId: string, key: string, documentIds: string[]): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#setFilingDocumentsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setFilingDocuments(deps, ctx, { filingId, key, documentIds });
    revalidate(filingId);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

export async function saveTransparencyAction(input: { filingId: string; answers: Record<string, boolean>; checkedOn: string; confirmationDocumentId?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#saveTransparencyAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveTransparencyCheck(deps, ctx, input);
    revalidate(input.filingId);
    return toActionState(result, t, t('governance.register.saved'));
  });
}

export async function completeFilingAction(input: { filingId: string; registeredOn: string; registerCourt?: string; registerNumber?: string; extractDocumentId?: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/register/actions.ts#completeFilingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await completeRegisterFiling(deps, ctx, input);
    revalidate(input.filingId);
    return toActionState(result, t, t('governance.register.completed'));
  });
}
