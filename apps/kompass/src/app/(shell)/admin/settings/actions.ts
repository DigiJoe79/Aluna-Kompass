'use server';

import { setSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveSettingsAction(changes: Record<string, unknown>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const fieldErrors: Record<string, string> = {};
  let message: string | null = null;
  for (const [key, value] of Object.entries(changes)) {
    const result = await setSetting(deps, ctx, { key, value });
    if (!result.ok) {
      const state = toActionState(result, t);
      if (state.status === 'error') {
        if (result.error.type === 'validation') fieldErrors[key] = state.fieldErrors.value ?? state.fieldErrors[''] ?? t('errors.fields.invalid');
        else message = state.message;
      }
    }
  }
  revalidatePath('/', 'layout');
  if (message) return { status: 'error', message, fieldErrors };
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', message: t('errors.validation'), fieldErrors };
  return { status: 'success', message: t('settings.toast.saved') };
}
