'use server';

import { guardAction } from '@/lib/action-guard';
import { addLocale, previewLocaleRemoval, removeLocale, reorderLocales, type LocaleRemovalPreview, type Result } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function addLocaleAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/admin/locales/actions.ts#addLocaleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const code = String(formData.get('code') ?? '').trim().toLowerCase();
    const result = await addLocale(deps, ctx, { code });
    revalidatePath('/admin/locales');
    return toActionState(result, t, t('admin.locales.added'));
  });
}

export async function reorderLocalesAction(codes: string[]): Promise<ActionState> {
  return guardAction('(shell)/admin/locales/actions.ts#reorderLocalesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reorderLocales(deps, ctx, { codes });
    revalidatePath('/admin/locales');
    return toActionState(result, t);
  });
}

/** Die Vorschau lehnt ab, wenn ein Modul die Sprache braucht; Erfolg trägt die Vorschau in `data`. */
export async function previewLocaleRemovalAction(code: string): Promise<ActionState> {
  return guardAction('(shell)/admin/locales/actions.ts#previewLocaleRemovalAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result: Result<LocaleRemovalPreview> = await previewLocaleRemoval(deps, ctx, { code });
    return result.ok ? ({ status: 'success', data: result.value } satisfies ActionState) : toActionState(result, t);
  });
}

export async function removeLocaleAction(code: string): Promise<ActionState> {
  return guardAction('(shell)/admin/locales/actions.ts#removeLocaleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await removeLocale(deps, ctx, { code, confirm: true });
    revalidatePath('/admin/locales');
    return toActionState(result, t, t('admin.locales.removed'));
  });
}
