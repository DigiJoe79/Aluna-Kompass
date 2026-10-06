'use server';

import { setSetting } from '@kompass/core';
import { PHOTO_FRAME_KEY, PROFILE_URL_KEY } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function saveAnimalSettingsAction(values: { frame: { aspect: string; focusX: number; focusY: number }; profileUrl: string }): Promise<ActionState> {
  return guardAction('(shell)/admin/animals/actions.ts#saveAnimalSettingsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const frame = await setSetting(deps, ctx, { key: PHOTO_FRAME_KEY, value: values.frame });
    const result = frame.ok ? await setSetting(deps, ctx, { key: PROFILE_URL_KEY, value: values.profileUrl }) : frame;
    revalidatePath('/admin/animals');
    revalidatePath('/animals', 'layout');
    return toActionState(result, t, t('animals.admin.saved'));
  });
}
