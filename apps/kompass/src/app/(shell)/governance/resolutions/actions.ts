'use server';

import { createFollowUp } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** „Auftrag anlegen …“: eine Wiedervorlage des Kerns am Beschluss (Recht des Kerns). */
export async function createMandateFollowUpAction(input: { resolutionId: string; title: string; dueAt: string; assigneeUserId: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/resolutions/actions.ts#createMandateFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createFollowUp(deps, ctx, { entityType: 'governanceResolution', entityId: input.resolutionId, title: input.title, dueAt: input.dueAt, assigneeUserId: input.assigneeUserId });
    revalidatePath(`/governance/resolutions/${input.resolutionId}`);
    return toActionState(result, t, t('governance.resolution.followUpSaved'));
  });
}
