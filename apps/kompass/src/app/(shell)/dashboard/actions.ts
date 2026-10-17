'use server';

import { guardAction } from '@/lib/action-guard';
import { resetDashboardLayout, setDashboardLayout, type DashboardLayoutKind, type LayoutTile } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** `{ layout, columns }` speichert die Anordnung dieses Layouts, `{ layout }` allein schaltet nur um (Plan 0.2.12 M3). */
export async function saveDashboardLayoutAction(input: { layout: DashboardLayoutKind; columns?: LayoutTile[][] }): Promise<ActionState> {
  return guardAction('(shell)/dashboard/actions.ts#saveDashboardLayoutAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setDashboardLayout(deps, ctx, input);
    revalidatePath('/');
    return toActionState(result, t);
  });
}

export async function resetDashboardLayoutAction(): Promise<ActionState> {
  return guardAction('(shell)/dashboard/actions.ts#resetDashboardLayoutAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resetDashboardLayout(deps, ctx);
    revalidatePath('/');
    return toActionState(result, t, t('dashboard.customize.resetDone'));
  });
}
