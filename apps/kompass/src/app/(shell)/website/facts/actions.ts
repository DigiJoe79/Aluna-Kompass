'use server';

import { setSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveFactsAction(changes: Record<string, unknown>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!key.startsWith('website.')) continue;
    const result = await setSetting(deps, ctx, { key, value });
    if (!result.ok) {
      const state = toActionState(result, t);
      if (state.status === 'error') { if (result.error.type === 'validation') fieldErrors[key] = state.fieldErrors.value ?? state.fieldErrors[''] ?? t('errors.fields.invalid'); else return state; }
    }
  }
  revalidatePath('/website/facts');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', message: t('errors.validation'), fieldErrors };
  return { status: 'success', message: t('website.facts.saved') };
}
