'use server';

import { setSetting, storeMediaAsset } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function uploadLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('settings.logo.noFile'), fieldErrors: { logo: t('settings.logo.noFile') } };
  const stored = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  if (!stored.ok) return toActionState(stored, t);
  const saved = await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: stored.value.id });
  revalidatePath('/', 'layout');
  return toActionState(saved, t, t('settings.logo.saved'));
}