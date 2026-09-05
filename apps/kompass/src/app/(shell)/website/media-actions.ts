'use server';

import { storeMediaAsset } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function uploadMediaAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('website.common.noFile'), fieldErrors: {} };
  const result = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  return toActionState(result, t);
}
