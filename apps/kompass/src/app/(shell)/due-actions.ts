'use server';

import { completeFollowUp } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function completeDueAction(followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await completeFollowUp(deps, ctx, { id: followUpId });
  revalidatePath('/');
  revalidatePath('/dms');
  return toActionState(result, t, t('home.due.completed'));
}
