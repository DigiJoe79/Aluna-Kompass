'use server';

import { setModuleEnabled } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function setModuleEnabledAction(key: string, enabled: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setModuleEnabled(deps, ctx, { key, enabled });
  revalidatePath('/', 'layout');
  return toActionState(result, t, t(enabled ? 'modules.toast.enabled' : 'modules.toast.disabled'));
}
