'use server';

import { guardAction } from '@/lib/action-guard';
import { animalDeletionPreview, confirmAnimalReview, createAnimal, deleteAnimal, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '@kompass/module-animals';
import { requirePermission, type MediaCleanup } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { toDeletionPreviewView, type DeletionPreviewView } from '@/lib/deletion-preview';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';
import { formTab, listQueryString } from './list-params';
import { photosChanged, photosFromForm } from './photos-changed';
import { storyChanged } from './story-changed';

const NEXT_ID = /^[0-9A-Z]{26}$/;

const splitList = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function saveAnimalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/animals/actions.ts#saveAnimalAction', async () => {
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
      place: String(formData.get('place') ?? '').trim(),
      isEmergency: formData.get('isEmergency') === 'on',
      isSponsorable: formData.get('isSponsorable') === 'on',
      traits: { de: splitList(formData.get('traits__text.de')), en: splitList(formData.get('traits__text.en')) },
      externalProfileUrl: String(formData.get('externalProfileUrl') ?? '').trim(),
      summary: localizedFromForm(formData, 'summary', deps.locales()),
      body: localizedFromForm(formData, 'body', deps.locales()),
    };
    const expectedVersion = String(formData.get('expectedVersion') ?? '') || undefined;
    const result = id ? await updateAnimal(deps, ctx, { id, expectedVersion, ...fields }) : await createAnimal(deps, ctx, fields);
    revalidatePath('/animals');
    if (!result.ok) return toActionState(result, t);
    if (!id) redirect(`/animals/${result.value.id}`);
    // Fotos reisen mit demselben Speichern. Geschrieben wird nur bei einer
    // Änderung – sonst stünde nach jedem Speichern ein leerer Fotoeintrag im
    // Protokoll. Scheitern die Fotos, ist der Text schon gespeichert; die neu
    // geladene Seite trägt dann den neuen Versionsstempel.
    let current = result.value;
    const chosen = photosFromForm(formData.get('photos'));
    if (chosen && photosChanged(current.photos, chosen)) {
      const withPhotos = await setAnimalPhotos(deps, ctx, { id, photos: chosen });
      if (!withPhotos.ok) return toActionState(withPhotos, t);
      current = withPhotos.value;
    }
    // Die Geschichte steht im selben Formular. Geschrieben wird sie nur bei einem vermittelten Hund und nur
    // bei einer Änderung.
    if (current.status === 'adopted' && formData.has('adoptedYear')) {
      const story = {
        beforeAssetId: String(formData.get('beforeAssetId') ?? '') || null,
        afterAssetId: String(formData.get('afterAssetId') ?? '') || null,
        quote: localizedFromForm(formData, 'quote', deps.locales()),
        family: String(formData.get('family') ?? '').trim(),
        adoptedYear: Number(formData.get('adoptedYear') ?? 0),
        beforeCaption: localizedFromForm(formData, 'beforeCaption', deps.locales()),
        afterCaption: localizedFromForm(formData, 'afterCaption', deps.locales()),
      };
      if (storyChanged(current.story, story)) {
        const withStory = await setAnimalStory(deps, ctx, { id, ...story });
        if (!withStory.ok) return toActionState(withStory, t);
        current = withStory.value;
      }
    }
    // „Veröffentlicht“ ist in der Maske ein Feld wie jedes andere; die Sofortaktion gibt es nur in der Liste.
    const wanted = formData.get('isPublished');
    if ((wanted === '1' || wanted === '0') && (wanted === '1') !== current.isPublished) {
      const switched = await setAnimalPublished(deps, ctx, { id, isPublished: wanted === '1' });
      if (!switched.ok) return toActionState(switched, t);
      current = switched.value;
    }
    // Welcher Knopf: `save` bleibt stehen, `next` geht weiter, `confirm` bestätigt die Prüfung (und geht weiter, wo es ein Weiter gibt).
    const intent = String(formData.get('intent') ?? 'save');
    if (intent === 'confirm') {
      // Mit dem frischen Stempel: Text und Fotos hat dieselbe Person eben selbst geschrieben. Ein Schreiben
      // des Agenten seit dem Laden der Maske hat schon `updateAnimal` oben abgewiesen.
      const confirmed = await confirmAnimalReview(deps, ctx, { id, expectedVersion: current.updatedAt, publish: formData.get('publishOnConfirm') === 'on' });
      revalidatePath('/animals');
      if (!confirmed.ok) return toActionState(confirmed, t);
    }
    // `queue` und `nextId` kommen aus dem Browser und landen in einer Weiterleitung: nur die bekannten
    // Listenparameter und nur eine ULID.
    const queue = listQueryString(Object.fromEntries(new URLSearchParams(String(formData.get('queue') ?? ''))));
    if ((intent === 'next' || intent === 'confirm') && queue) {
      const nextId = String(formData.get('nextId') ?? '');
      if (!NEXT_ID.test(nextId)) redirect(`/animals?${queue}`);
      redirect(`/animals/${nextId}?${queue}&tab=${formTab(String(formData.get('tab') ?? ''))}`);
    }
    return toActionState(result, t, t(intent === 'confirm' ? 'animals.review.confirmed' : 'content.saved'));
  });
}

export async function setAnimalStatusAction(id: string, status: string, adoptedYear?: number): Promise<ActionState> {
  return guardAction('(shell)/animals/actions.ts#setAnimalStatusAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setAnimalStatus(deps, ctx, { id, status, adoptedYear });
    revalidatePath('/animals');
    return toActionState(result, t, t('animals.status.saved'));
  });
}

export async function setAnimalPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  return guardAction('(shell)/animals/actions.ts#setAnimalPublishedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setAnimalPublished(deps, ctx, { id, isPublished });
    revalidatePath('/animals');
    return toActionState(result, t);
  });
}

export async function animalDeletionPreviewAction(id: string): Promise<DeletionPreviewView | null> {
  const { deps, ctx } = await requireSession();
  const preview = await animalDeletionPreview(deps, ctx, id);
  return preview.ok ? toDeletionPreviewView(preview.value, !requirePermission(ctx, 'media.upload')) : null;
}

export async function deleteAnimalAction(id: string, deleteOrphanedMedia: boolean): Promise<ActionState> {
  return guardAction('(shell)/animals/actions.ts#deleteAnimalAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteAnimal(deps, ctx, { id, deleteOrphanedMedia });
    revalidatePath('/animals');
    return toActionState(result, t, result.ok ? t('deletion.deletedWithMedia', { count: (result.value as MediaCleanup).deletedMedia.length }) : undefined);
  });
}
