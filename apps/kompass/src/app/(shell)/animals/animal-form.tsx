'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { SubmitButton } from '@/components/forms/submit-button';
import { FormErrorSummary, TabInvalidDot } from '@/components/forms/form-error-summary';
import { invalidTabs } from '@/lib/form-errors';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ActionForm } from '@/components/forms/action-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState } from '@/lib/actions';
import { saveAnimalAction } from './actions';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import type { AnimalQueue, FormTab } from './list-params';
import { PhotosEditor, type EditorPhoto } from './photos-editor';
import { ReviewBand } from './review-band';
import { mergePhotos } from './photos-merge';
import { StatusDialog } from './status-dialog';
import { StoryFields } from './story-form';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/**
 * Welches Feld auf welchem Reiter steht. Nur dafür da, einen Fehler dort
 * anzuzeigen, wo er steckt — die Felder selbst stehen unten im JSX.
 */
const TABS = [
  {
    key: 'profile',
    fields: ['slug', 'name', 'sex', 'location', 'place', 'sizeCm', 'externalProfileUrl', 'birthText', 'sizeText'],
  },
  { key: 'content', fields: ['summary', 'body', 'traits__text', 'traits', 'photos'] },
  { key: 'story', fields: ['beforeAssetId', 'afterAssetId', 'quote', 'family', 'adoptedYear', 'beforeCaption', 'afterCaption'] },
] as const;

/** Bindet den Haken im Prüfband ans Formular, obwohl das Band außerhalb steht. */
const FORM_ID = 'animal-form';

export function AnimalForm({ animal, locales, queue, initialTab, backHref, photoFrame }: { animal: AnimalRecord | null; locales: string[]; queue: AnimalQueue | null; initialTab: FormTab; backHref: string; photoFrame: { aspectRatio: string; objectPosition: string } }) {
  const t = useTranslations('animals.form');
  const p = useTranslations('animals.photos');
  const r = useTranslations('animals.review');
  const c = useTranslations('content');
  const tCommon = useTranslations('common');
  const [state, action] = useActionState(saveAnimalAction, idleState);
  const [tab, setTab] = useState<FormTab>(initialTab);
  // Der Fotostand lebt hier und nicht im Editor: Er reist als verstecktes Feld
  // mit dem einen Speichern, und der Medienwähler steht außerhalb des Formulars.
  const [photos, setPhotos] = useState<EditorPhoto[]>(() => (animal?.photos ?? []).map(({ assetId, isPrimary }) => ({ assetId, isPrimary })));
  const [chooserOpen, setChooserOpen] = useState(false);
  const [baseline, setBaseline] = useState(0);
  // In der Maske heißt Speichern Speichern: Auch „veröffentlicht“ ist hier ein Feld und wird erst mit dem
  // Speichern geschrieben. In der Liste bleibt der Schalter eine Sofortaktion.
  const [published, setPublished] = useState(animal?.isPublished ?? false);
  // Zählt, was die Speicherleiste nicht von selbst sieht: Änderungen an versteckten Feldern.
  const [hiddenEdits, setHiddenEdits] = useState(0);
  const hiddenField = useRef<HTMLInputElement>(null);
  // `useMemo`, weil `errors` sonst bei jedem Render ein neues Objekt waere und
  // der Effekt unten damit bei jedem Render feuerte statt nur bei einer
  // Zustandsaenderung — der Toast erschiene mehrfach.
  const errors = useMemo(() => (state.status === 'error' ? state.fieldErrors : {}), [state]);
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      // Die Maske bleibt stehen: Die Speicherleiste zählt ab dem neuen Stand wieder bei null.
      setBaseline((n) => n + 1);
    } else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message);
  }, [state, errors]);
  // Die Speicherleiste horcht auf `input` am Formular; ein verstecktes Feld
  // feuert keines. Ohne diesen Anstoß zählte sie eine solche Änderung nicht mit
  // (Fotos, Veröffentlicht-Schalter, die Bilder der Geschichte.)
  useEffect(() => {
    if (hiddenEdits === 0) return;
    hiddenField.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [hiddenEdits]);
  const hiddenEdited = () => setHiddenEdits((n) => n + 1);
  const changePhotos = (next: EditorPhoto[]) => { setPhotos(next); hiddenEdited(); };
  // Bestätigen kann veröffentlichen, und die Liste schaltet sofort: Der Schalter folgt dem gespeicherten Stand.
  const savedPublished = animal?.isPublished ?? false;
  useEffect(() => { setPublished(savedPublished); }, [savedPublished]);
  const changeTab = (value: FormTab) => {
    setTab(value);
    // Nur die Adresse nachziehen, ohne den Server zu fragen: Der Reiter reist so zum nächsten Hund mit.
    const next = new URLSearchParams(window.location.search);
    next.set('tab', value);
    window.history.replaceState(null, '', `?${next}`);
  };
  const broken = invalidTabs(TABS, errors);
  // „Mit Warteschlange“ heißt: Der Hund steht in der Auswahl, aus der man kam.
  // Der Platz in der Liste gilt, wie er beim Öffnen der Maske war. Fällt der Hund hier drin aus dem Filter
  // (Veröffentlicht-Schalter, Statuswechsel, ein Speichern), bleibt „weiter“ stehen – sonst säße man im
  // Eintrag fest (Befund vom 2026-09-30). `key` an der Maske setzt das je Hund neu.
  const [openedAt] = useState(queue?.position ?? null);
  const position = queue?.position ?? openedAt;
  const pending = !!animal?.reviewRequestedAt;
  // Eine primäre Aktion; sobald sie mehr tut als speichern, bleibt „Speichern“ als zweiter Weg daneben.
  const primary = pending
    ? { intent: 'confirm', label: position ? r('confirmNext') : r('confirm') }
    : position
      ? { intent: 'next', label: t('saveNext') }
      : null;
  return (
    <div className="flex flex-col gap-4">
      {animal ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <StatusBadge tone={animal.status === 'adopted' ? 'success' : animal.status === 'reserved' ? 'warning' : 'info'} dot>{t(`status.${animal.status}`)}</StatusBadge>
          <StatusDialog animalId={animal.id} current={animal.status} />
          <label className="ml-auto flex items-center gap-2 text-[13px]">
            {/* Text vor dem Schalter: rechtsbündig sitzt der Schalter so immer an derselben Stelle, wie in der Liste. */}
            <span className={published ? 'text-success' : 'text-muted-ink'}>{published ? c('published') : c('unpublished')}</span>
            <Switch checked={published} aria-label={c('published')} onCheckedChange={(next) => { setPublished(next); hiddenEdited(); }} />
          </label>
        </div>
      ) : null}
      {animal?.reviewRequestedAt ? <ReviewBand requestedAt={animal.reviewRequestedAt} note={animal.reviewNote} canPublish={!animal.isPublished} formId={FORM_ID} /> : null}
      <FormErrorSummary errors={errors} />
      <Tabs value={tab} onValueChange={(value) => changeTab(value as FormTab)} className="overflow-hidden rounded-lg border border-line bg-surface">
        <TabsList className="border-b border-line bg-surface px-6"><TabsTrigger value="profile" className="gap-2">{t('tabs.profile')}{broken.has('profile') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="content" className="gap-2">{t('tabs.content')}{broken.has('content') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="story" disabled={!animal}>{t('tabs.story')}</TabsTrigger></TabsList>
        {/*
          Reiter und Ladestand reisen beim Abschicken mit, aber nicht als Felder: Die Speicherleiste zählte sonst
          den Reiterwechsel als Änderung – und den neuen Ladestand nach „Status ändern“ ebenso.
          Ladestand: Hat inzwischen jemand anderes gespeichert, weist der Dienst ab (Backlog 20).
        */}
        <ActionForm id={FORM_ID} action={(data) => { data.set('tab', tab); if (animal) data.set('expectedVersion', animal.updatedAt); action(data); }} state={state}>
          {animal ? <input type="hidden" name="id" value={animal.id} /> : null}
          {animal ? <input ref={hiddenField} type="hidden" name="photos" value={JSON.stringify(photos)} /> : null}
          {animal ? <input type="hidden" name="isPublished" value={published ? '1' : '0'} /> : null}
          {/* Der Nachfolger steht beim Rendern fest: Fällt dieser Hund mit dem Bestätigen aus dem Filter, stimmt das Ziel trotzdem. */}
          {position ? <><input type="hidden" name="queue" value={queue?.query ?? ''} /><input type="hidden" name="nextId" value={position.nextId ?? ''} /></> : null}
          <TabsContent keepMounted value="profile" className="grid gap-4 p-6 md:grid-cols-2">
            <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug} required><Input id="slug" name="slug" defaultValue={animal?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
            <FormField id="name" label={t('name')} error={errors.name} required><Input id="name" name="name" defaultValue={animal?.name ?? ''} required /></FormField>
            <FormField id="sex" label={t('sex')}><Select id="sex" name="sex" defaultValue={animal?.sex ?? 'female'} className="w-auto"><option value="female">{t('sexes.female')}</option><option value="male">{t('sexes.male')}</option></Select></FormField>
            <FormField id="location" label={t('location')}><Select id="location" name="location" defaultValue={animal?.location ?? 'shelter'} className="w-auto"><option value="shelter">{t('locations.shelter')}</option><option value="germany">{t('locations.germany')}</option></Select></FormField>
            <FormField id="place" label={t('place')} hint={t('placeHint')} error={errors.place}><Input id="place" name="place" defaultValue={animal?.place ?? ''} /></FormField>
            <FormField id="sizeCm" label={t('sizeCm')} error={errors.sizeCm}><Input id="sizeCm" name="sizeCm" type="number" defaultValue={animal?.sizeCm ?? 0} className="font-mono" /></FormField>
            <FormField id="externalProfileUrl" label={t('externalProfileUrl')} hint={t('externalHint')} error={errors.externalProfileUrl}><Input id="externalProfileUrl" name="externalProfileUrl" defaultValue={animal?.externalProfileUrl ?? ''} /></FormField>
            <LocalizedField name="birthText" label={t('birthText')} value={animal?.birthText ?? {}} errors={errors} locales={locales} />
            <LocalizedField name="sizeText" label={t('sizeText')} value={animal?.sizeText ?? {}} errors={errors} locales={locales} />
            <div className="flex items-center gap-2"><Checkbox id="isEmergency" name="isEmergency" defaultChecked={animal?.isEmergency ?? false} /><Label htmlFor="isEmergency">{t('isEmergency')}</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="isSponsorable" name="isSponsorable" defaultChecked={animal?.isSponsorable ?? false} /><Label htmlFor="isSponsorable">{t('isSponsorable')}</Label></div>
          </TabsContent>
          {/* Texte links, Fotos rechts: Wer prüft, sieht beides nebeneinander und speichert einmal. */}
          <TabsContent keepMounted value="content" className="grid gap-6 p-6 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <LocalizedField name="summary" label={t('summary')} kind="textarea" rows={2} value={animal?.summary ?? {}} errors={errors} locales={locales} />
              <LocalizedField name="body" label={t('body')} kind="markdown" rows={10} value={animal?.body ?? {}} errors={errors} locales={locales} />
              <LocalizedField name="traits__text" label={t('traits')} hint={t('traitsHint')} value={Object.fromEntries(locales.map((l) => [l, ((animal?.traits as Record<string, string[]> | undefined)?.[l] ?? []).join(', ')]))} locales={locales} />
            </div>
            {animal ? <PhotosEditor photos={photos} onChange={changePhotos} onChoose={() => setChooserOpen(true)} frame={photoFrame} /> : <p className="h-fit rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2">{p('afterCreate')}</p>}
          </TabsContent>
          <TabsContent keepMounted value="story" className="flex flex-col gap-4 p-6">{animal ? <StoryFields animal={animal} locales={locales} errors={errors} onMediaChange={hiddenEdited} /> : null}</TabsContent>
          {/* Eine Leiste für alle Reiter: Sie zählt und speichert, was auf irgendeinem von ihnen geändert wurde. */}
          {/* „Speichern“ steht im DOM zuerst: Die Eingabetaste in einem Feld speichert nur, sie bestätigt nichts. */}
          <FormActionBar
            baseline={baseline}
            loadedVersion={animal?.updatedAt}
            back={{ href: backHref, label: tCommon('backToList') }}
            saveName="intent"
            saveValue={primary?.intent ?? 'save'}
            saveLabel={primary?.label}
            extraActions={primary ? <SubmitButton variant="secondary" name="intent" value="save">{tCommon('save')}</SubmitButton> : undefined}
          />
        </ActionForm>
      </Tabs>
      {/* Außerhalb des Formulars: Ein Dialog ist ein React-Portal, und was darin geschieht, stiege sonst ins Formular auf. */}
      {animal ? <MediaChooserDialog open={chooserOpen} onOpenChange={setChooserOpen} kind="image" multiple selected={photos.map((x) => x.assetId)} onConfirm={(ids) => changePhotos(mergePhotos(photos, ids))} /> : null}
    </div>
  );
}
