'use server';

import { guardAction } from '@/lib/action-guard';
import { activateTheme, deleteTheme, duplicateTheme, updateTheme } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveThemeAction(theme: unknown): Promise<ActionState> {
  return guardAction('(shell)/admin/themes/actions.ts#saveThemeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateTheme(deps, ctx, theme);
    revalidatePath('/', 'layout');
    return toActionState(result, t, t('themes.toast.saved'));
  });
}

export async function duplicateThemeAction(input: {
  sourceKey: string;
  key: string;
  name: string;
}): Promise<ActionState> {
  return guardAction('(shell)/admin/themes/actions.ts#duplicateThemeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await duplicateTheme(deps, ctx, input);
    revalidatePath('/', 'layout');
    return toActionState(result, t, t('themes.toast.duplicated'));
  });
}

export async function deleteThemeAction(key: string): Promise<ActionState> {
  return guardAction('(shell)/admin/themes/actions.ts#deleteThemeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteTheme(deps, ctx, { key });
    revalidatePath('/', 'layout');
    return toActionState(result, t, t('themes.toast.deleted'));
  });
}

export async function activateThemeAction(key: string): Promise<ActionState> {
  return guardAction('(shell)/admin/themes/actions.ts#activateThemeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await activateTheme(deps, ctx, { key });
    revalidatePath('/', 'layout');
    return toActionState(result, t, t('themes.toast.activated'));
  });
}
