'use server';

import { setSetting } from '@kompass/core';
import { PHOTO_FRAME_KEY } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function savePhotoFrameAction(frame: { aspect: string; focusX: number; focusY: number }): Promise<ActionState> {
  return guardAction('(shell)/admin/animals/actions.ts#savePhotoFrameAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setSetting(deps, ctx, { key: PHOTO_FRAME_KEY, value: frame });
    revalidatePath('/admin/animals');
    revalidatePath('/animals', 'layout');
    return toActionState(result, t, t('animals.admin.saved'));
  });
}
