'use server';

import { endTerm, saveOffice, saveOrgan, setOfficeActive, setOrganActive, startTerm } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const revalidate = (organId?: string) => {
  revalidatePath('/governance');
  if (organId) revalidatePath(`/governance/organs/${organId}`);
};

/** Organ anlegen (nur Art „anderes Organ“) oder umbenennen. */
export async function saveOrganAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#saveOrganAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const id = String(formData.get('id') ?? '') || undefined;
    const kind = String(formData.get('kind') ?? 'other');
    const result = await saveOrgan(deps, ctx, { ...(id ? { id } : {}), kind, name: String(formData.get('name') ?? '') });
    revalidate(id);
    if (!result.ok) return toActionState(result, t);
    if (!id) redirect(`/governance/organs/${result.value.id}`);
    return toActionState(result, t, t('governance.organ.saved'));
  });
}

export async function setOrganActiveAction(id: string, active: boolean): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#setOrganActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setOrganActive(deps, ctx, { id, active });
    revalidate(id);
    return toActionState(result, t, t(active ? 'governance.organ.activated' : 'governance.organ.archived'));
  });
}

export interface OfficeInput {
  id?: string;
  organId: string;
  name: string;
  seats: number;
  representative: boolean;
  termMonths: number | null;
  untilSuccessor: boolean;
  function: string | null;
  incompatibleWith: string[];
}

export async function saveOfficeAction(input: OfficeInput): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#saveOfficeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveOffice(deps, ctx, input);
    revalidate(input.organId);
    return toActionState(result, t, t('governance.office.saved'));
  });
}

export async function setOfficeActiveAction(organId: string, id: string, active: boolean): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#setOfficeActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setOfficeActive(deps, ctx, { id, active });
    revalidate(organId);
    return toActionState(result, t, t(active ? 'governance.office.activated' : 'governance.office.archived'));
  });
}

export interface SeatInput {
  organId: string;
  officeId: string;
  contactId: string;
  since: string;
  origin: string;
  documentId?: string;
  note?: string;
}

/** „Besetzen …“: Die Warnungen des Dienstes gehen als `data.warnings` zurück — Hinweis, keine Sperre. */
export async function startTermAction(input: SeatInput): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#startTermAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const { organId, ...rest } = input;
    const result = await startTerm(deps, ctx, rest);
    revalidate(organId);
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('governance.seat.saved'), data: { warnings: result.value.warnings } };
  });
}

export async function endTermAction(organId: string, input: { id: string; until: string; reason: string; receivedOn?: string; documentId?: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/organs/actions.ts#endTermAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endTerm(deps, ctx, input);
    revalidate(organId);
    return toActionState(result, t, t('governance.termEnd.saved'));
  });
}
