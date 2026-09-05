'use server';

import { storeMediaAsset } from '@kompass/core';
import { setDownload } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function setDownloadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const key = String(formData.get('key') ?? '');
  let assetId = String(formData.get('assetId') ?? '') || null;
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    const stored = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
    if (!stored.ok) return toActionState(stored, t);
    assetId = stored.value.id;
  }
  const result = await setDownload(deps, ctx, { key, title: localizedFromForm(formData, 'title'), assetId });
  revalidatePath('/website/downloads');
  return toActionState(result, t, t('website.common.saved'));
}
