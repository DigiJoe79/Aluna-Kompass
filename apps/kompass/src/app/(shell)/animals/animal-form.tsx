'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormErrorSummary, TabInvalidDot } from '@/components/forms/form-error-summary';
import { invalidTabs } from '@/lib/form-errors';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState } from '@/lib/actions';
import { setAnimalPublishedAction, saveAnimalAction } from './actions';
import { PhotosEditor } from './photos-editor';
import { StatusDialog } from './status-dialog';
import { StoryForm } from './story-form';
import { Select } from '@/components/ui/select';

/**
 * Welches Feld auf welchem Reiter steht. Nur dafür da, einen Fehler dort
 * anzuzeigen, wo er steckt — die Felder selbst stehen unten im JSX.
 */
const TABS = [
  {
    key: 'profile',
    fields: ['slug', 'name', 'sex', 'location', 'sizeCm', 'externalProfileUrl', 'birthText', 'sizeText'],
  },
  { key: 'texts', fields: ['summary', 'body', 'traits__text', 'traits'] },
] as const;

export function AnimalForm({ animal, locales }: { animal: AnimalRecord | null; locales: string[] }) {
  const t = useTranslations('animals.form');
  const c = useTranslations('content');
  const tCommon = useTranslations('common');
  const [state, action] = useActionState(saveAnimalAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  const broken = invalidTabs(TABS, errors);
  return (
    <div className="flex flex-col gap-4">
      {animal ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <StatusBadge tone={animal.status === 'adopted' ? 'success' : animal.status === 'reserved' ? 'warning' : 'info'} dot>{t(`status.${animal.status}`)}</StatusBadge>
          <StatusDialog animalId={animal.id} current={animal.status} />
          <span className="ml-auto"><PublishSwitch id={animal.id} isPublished={animal.isPublished} action={setAnimalPublishedAction} /></span>
        </div>
      ) : null}
      <FormErrorSummary errors={errors} />
      <Tabs defaultValue="profile" className="overflow-hidden rounded-lg border border-line bg-surface">
        <TabsList className="border-b border-line bg-surface px-6"><TabsTrigger value="profile" className="gap-2">{t('tabs.profile')}{broken.has('profile') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="texts" className="gap-2">{t('tabs.texts')}{broken.has('texts') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="photos" disabled={!animal}>{t('tabs.photos')}</TabsTrigger><TabsTrigger value="story" disabled={!animal}>{t('tabs.story')}</TabsTrigger></TabsList>
        <form action={action}>
          {animal ? <input type="hidden" name="id" value={animal.id} /> : null}
          <TabsContent keepMounted value="profile" className="grid gap-4 p-6 md:grid-cols-2">
            <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={animal?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
            <FormField id="name" label={t('name')} error={errors.name}><Input id="name" name="name" defaultValue={animal?.name ?? ''} required /></FormField>
            <FormField id="sex" label={t('sex')}><Select id="sex" name="sex" defaultValue={animal?.sex ?? 'female'} className="w-auto"><option value="female">{t('sexes.female')}</option><option value="male">{t('sexes.male')}</option></Select></FormField>
            <FormField id="location" label={t('location')}><Select id="location" name="location" defaultValue={animal?.location ?? 'shelter'} className="w-auto"><option value="shelter">{t('locations.shelter')}</option><option value="germany">{t('locations.germany')}</option></Select></FormField>
            <FormField id="sizeCm" label={t('sizeCm')} error={errors.sizeCm}><Input id="sizeCm" name="sizeCm" type="number" defaultValue={animal?.sizeCm ?? 0} className="font-mono" /></FormField>
            <FormField id="externalProfileUrl" label={t('externalProfileUrl')} hint={t('externalHint')} error={errors.externalProfileUrl}><Input id="externalProfileUrl" name="externalProfileUrl" defaultValue={animal?.externalProfileUrl ?? ''} /></FormField>
            <LocalizedField name="birthText" label={t('birthText')} value={animal?.birthText ?? {}} errors={errors} locales={locales} />
            <LocalizedField name="sizeText" label={t('sizeText')} value={animal?.sizeText ?? {}} errors={errors} locales={locales} />
            <div className="flex items-center gap-2"><Checkbox id="isEmergency" name="isEmergency" defaultChecked={animal?.isEmergency ?? false} /><Label htmlFor="isEmergency">{t('isEmergency')}</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="isSponsorable" name="isSponsorable" defaultChecked={animal?.isSponsorable ?? false} /><Label htmlFor="isSponsorable">{t('isSponsorable')}</Label></div>
          </TabsContent>
          <TabsContent keepMounted value="texts" className="grid gap-4 p-6 md:grid-cols-2">
            <LocalizedField name="summary" label={t('summary')} kind="textarea" rows={2} value={animal?.summary ?? {}} errors={errors} locales={locales} />
            <LocalizedField name="body" label={t('body')} kind="markdown" rows={10} value={animal?.body ?? {}} errors={errors} locales={locales} />
            <LocalizedField name="traits__text" label={t('traits')} hint={t('traitsHint')} value={Object.fromEntries(locales.map((l) => [l, ((animal?.traits as Record<string, string[]> | undefined)?.[l] ?? []).join(', ')]))} locales={locales} />
          </TabsContent>
          <FormActionBar back={{ href: '/animals', label: tCommon('backToList') }} />
        </form>
        <TabsContent value="photos" className="p-6">{animal ? <PhotosEditor animalId={animal.id} initial={animal.photos} /> : null}</TabsContent>
        <TabsContent value="story" className="p-6">{animal ? <StoryForm animal={animal} locales={locales} /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
