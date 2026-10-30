'use server';

import { setAgentSwitches } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Seite Verwaltung → Agenten (Spec 2026-10-29): die geänderten Schalter an `setAgentSwitches` — der Dienst prüft
 * `settings.manage` und den Kanal, schreibt nur, was sich ändert, und protokolliert je Schalter.
 */
export async function saveAgentSwitchesAction(values: Record<string, boolean>): Promise<ActionState> {
  return guardAction('(shell)/admin/agents/actions.ts#saveAgentSwitchesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setAgentSwitches(deps, ctx, { values });
    // Die Schalter wirken in den Modulen (Hinweise, Sperren); deshalb die ganze Schale neu.
    revalidatePath('/', 'layout');
    return toActionState(result, t, t('admin.agents.saved'));
  });
}
