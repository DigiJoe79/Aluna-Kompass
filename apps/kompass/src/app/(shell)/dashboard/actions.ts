'use server';

import { resetDashboardLayout, setDashboardLayout, type LayoutTile } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveDashboardLayoutAction(tiles: LayoutTile[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setDashboardLayout(deps, ctx, { tiles });
  revalidatePath('/');
  return toActionState(result, t);
}

export async function resetDashboardLayoutAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await resetDashboardLayout(deps, ctx);
  revalidatePath('/');
  return toActionState(result, t, t('dashboard.customize.resetDone'));
}
