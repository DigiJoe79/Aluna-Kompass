'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveAnimalStoryAction } from './actions';

export function StoryForm({ animal }: { animal: AnimalRecord }) {
  const t = useTranslations('animals.story');
  const [state, action] = useActionState(saveAnimalStoryAction, idleState);
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error') toast.error(state.message); }, [state]);
  if (animal.status !== 'adopted') return <p className="rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2">{t('locked')}</p>;
  const story = animal.story;
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="id" value={animal.id} />
      <div><MediaPicker name="beforeAssetId" value={story?.beforeAssetId ?? null} label={t('before')} /></div>
      <div><MediaPicker name="afterAssetId" value={story?.afterAssetId ?? null} label={t('after')} /></div>
      <LocalizedField name="quote" label={t('quote')} kind="textarea" rows={3} value={story?.quote ?? { de: '', en: '' }} />
      <FormField id="family" label={t('family')}><Input id="family" name="family" defaultValue={story?.family ?? ''} /></FormField>
      <FormField id="adoptedYear" label={t('year')}><Input id="adoptedYear" name="adoptedYear" type="number" defaultValue={story?.adoptedYear ?? new Date().getFullYear()} className="font-mono" /></FormField>
      <div className="flex justify-end md:col-span-2"><SubmitButton>{t('save')}</SubmitButton></div>
    </form>
  );
}
