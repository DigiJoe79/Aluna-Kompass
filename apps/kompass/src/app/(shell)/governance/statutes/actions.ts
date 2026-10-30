'use server';

import { createStatuteDraft, deleteStatuteDraft, previewStatuteRulesChange, registerStatute, updateStatute, type RulesChangePreview, type StatuteRules } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const revalidate = (id?: string) => {
  revalidatePath('/governance/statutes');
  revalidatePath('/governance');
  if (id) revalidatePath(`/governance/statutes/${id}`);
};

/** „Stand anlegen“: ein Entwurf auf Basis des gültigen Stands; `data.id` führt zur Bearbeitung. */
export async function createStatuteDraftAction(basedOnId: string | null): Promise<ActionState> {
  return guardAction('(shell)/governance/statutes/actions.ts#createStatuteDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createStatuteDraft(deps, ctx, basedOnId ? { basedOnId } : {});
    revalidate();
    return toActionState(result, t);
  });
}

/** Speichert nur die geänderten Felder eines Stands (auch das Regelwerk). */
export async function updateStatuteAction(input: Record<string, unknown> & { id: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/statutes/actions.ts#updateStatuteAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateStatute(deps, ctx, input);
    revalidate(input.id);
    return toActionState(result, t, t('governance.statute.saved'));
  });
}

/** G-5: Vor dem Speichern des Regelwerks eines eingetragenen Stands — welche festgeschriebenen Beschlüsse es anders bewertet. */
export async function previewStatuteRulesChangeAction(id: string, rules: StatuteRules): Promise<RulesChangePreview | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewStatuteRulesChange(deps, ctx, { id, rules });
  return result.ok ? result.value : null;
}

export async function registerStatuteAction(id: string, registeredOn: string): Promise<ActionState> {
  return guardAction('(shell)/governance/statutes/actions.ts#registerStatuteAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await registerStatute(deps, ctx, { id, registeredOn });
    revalidate(id);
    return toActionState(result, t, t('governance.statute.registered'));
  });
}

export async function deleteStatuteDraftAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/governance/statutes/actions.ts#deleteStatuteDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteStatuteDraft(deps, ctx, { id });
    revalidate();
    return toActionState(result, t, t('governance.statute.deleted'));
  });
}
