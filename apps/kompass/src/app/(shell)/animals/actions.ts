'use server';

import { storeMediaAsset } from '@kompass/core';
import { createAnimal, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

const splitList = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function saveAnimalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    sex: String(formData.get('sex') ?? 'female'),
    birthText: localizedFromForm(formData, 'birthText', deps.locales()),
    sizeCm: Number(formData.get('sizeCm') ?? 0),
    sizeText: localizedFromForm(formData, 'sizeText', deps.locales()),
    location: String(formData.get('location') ?? 'shelter'),
    isEmergency: formData.get('isEmergency') === 'on',
    isSponsorable: formData.get('isSponsorable') === 'on',
    traits: { de: splitList(formData.get('traits__text.de')), en: splitList(formData.get('traits__text.en')) },
    externalProfileUrl: String(formData.get('externalProfileUrl') ?? '').trim(),
    summary: localizedFromForm(formData, 'summary', deps.locales()),
    body: localizedFromForm(formData, 'body', deps.locales()),
  };
  const result = id ? await updateAnimal(deps, ctx, { id, ...fields }) : await createAnimal(deps, ctx, fields);
  revalidatePath('/animals');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/animals/${result.value.id}`);
  return toActionState(result, t, t('website.common.saved'));
}

export async function setAnimalStatusAction(id: string, status: string, adoptedYear?: number): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalStatus(deps, ctx, { id, status, adoptedYear });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.status.saved'));
}

export async function setAnimalPhotosAction(id: string, photos: { assetId: string; isPrimary: boolean }[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalPhotos(deps, ctx, { id, photos });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.photos.saved'));
}

export async function uploadAnimalPhotoAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('website.common.noFile'), fieldErrors: {} };
  const result = await storeMediaAsset(deps, ctx, { originalName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredMimeType: file.type });
  return toActionState(result, t);
}

export async function saveAnimalStoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalStory(deps, ctx, {
    id: String(formData.get('id') ?? ''),
    beforeAssetId: String(formData.get('beforeAssetId') ?? '') || null,
    afterAssetId: String(formData.get('afterAssetId') ?? '') || null,
    quote: localizedFromForm(formData, 'quote', deps.locales()),
    family: String(formData.get('family') ?? '').trim(),
    adoptedYear: Number(formData.get('adoptedYear') ?? 0),
  });
  revalidatePath('/animals');
  return toActionState(result, t, t('animals.story.saved'));
}

export async function setAnimalPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setAnimalPublished(deps, ctx, { id, isPublished });
  revalidatePath('/animals');
  return toActionState(result, t);
}
