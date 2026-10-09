'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { FormCard } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { SubmitButton } from '@/components/forms/submit-button';
import { FormErrorSummary, TabInvalidDot } from '@/components/forms/form-error-summary';
import { invalidTabs } from '@/lib/form-errors';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ActionForm } from '@/components/forms/action-form';
import { lineTabsListClass, lineTabsTriggerClass, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
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
    fields: ['name', 'sex', 'location', 'place', 'sizeCm', 'externalProfileUrl', 'birthText', 'sizeText'],
  },
  { key: 'content', fields: ['summary', 'body', 'traits__text', 'traits', 'photos'] },
  { key: 'story', fields: ['beforeAssetId', 'afterAssetId', 'quote', 'family', 'adoptedYear', 'beforeCaption', 'afterCaption'] },
] as const;

/** Bindet den Haken im Prüfband ans Formular, obwohl das Band außerhalb steht. */
const FORM_ID = 'animal-form';
const TAB_LIST = cn(lineTabsListClass, 'px-5');
const TAB = lineTabsTriggerClass;

export function AnimalForm({ animal, locales, queue, initialTab, backHref, photoFrame, maxPhotos }: { animal: AnimalRecord | null; locales: string[]; queue: AnimalQueue | null; initialTab: FormTab; backHref: string; photoFrame: { aspectRatio: string; objectPosition: string }; maxPhotos: number }) {
  const t = useTranslations('animals.form');
  const p = useTranslations('animals.photos');
  const r = useTranslations('animals.review');
  const c = useTranslations('content');
  const tCommon = useTranslations('common');
  const s = useTranslations('animals.story');
  // Die Namen für die Fehlerbox, je Feld wie in `TABS`: Sie nennt jedes Feld mit seiner Meldung.
  const labels: Record<string, string> = {
    name: t('name'), sex: t('sex'), location: t('location'), place: t('place'), sizeCm: t('sizeCm'),
    externalProfileUrl: t('externalProfileUrl'), birthText: t('birthText'), sizeText: t('sizeText'),
    summary: t('summary'), body: t('body'), traits__text: t('traits'), traits: t('traits'), photos: p('label'),
    beforeAssetId: s('before'), afterAssetId: s('after'), quote: s('quote'), family: s('family'), adoptedYear: s('year'),
    beforeCaption: s('beforeCaption'), afterCaption: s('afterCaption'),
  };
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
    }
  }, [state]);
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
      <FormErrorSummary errors={errors} labels={labels} />
      {/* Die Karte trägt den Rahmen, nicht die Reiter: `overflow-hidden` am Reiter-Behälter hielt die Leiste fest (Befund 39). */}
      <FormCard>
        <Tabs value={tab} onValueChange={(value) => changeTab(value as FormTab)}>
          <TabsList variant="line" className={TAB_LIST}><TabsTrigger value="profile" className={TAB}>{t('tabs.profile')}{broken.has('profile') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="content" className={TAB}>{t('tabs.content')}{broken.has('content') ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="story" disabled={!animal} className={TAB}>{t('tabs.story')}</TabsTrigger></TabsList>
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
            <TabsContent keepMounted value="profile" className="p-5">
              <section>
                <h3 className="text-[15px] font-semibold">{t('sections.name')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    {animal ? (
                      // Fest seit dem Anlegen (Spec „Tier-Slug fest“): kein `name`, also reist er nicht mit dem Speichern.
                      <FormField id="slug" label={c('slug')} hint={t('slugFixed')}><Input id="slug" value={animal.slug} readOnly className="font-mono" /></FormField>
                    ) : null}
                    <FormField id="name" label={t('name')} error={errors.name} required><Input id="name" name="name" defaultValue={animal?.name ?? ''} required /></FormField>
                  </FormGrid>
                </div>
              </section>
              <section className="mt-5 border-t border-line pt-5">
                <h3 className="text-[15px] font-semibold">{t('sections.traits')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="sex" label={t('sex')} size="s"><Select id="sex" name="sex" defaultValue={animal?.sex ?? 'female'}><option value="female">{t('sexes.female')}</option><option value="male">{t('sexes.male')}</option></Select></FormField>
                    <FormField id="sizeCm" label={t('sizeCm')} error={errors.sizeCm} size="s"><Input id="sizeCm" name="sizeCm" type="number" defaultValue={animal?.sizeCm ?? 0} className="font-mono" /></FormField>
                    <LocalizedField name="sizeText" label={t('sizeText')} size="s" value={animal?.sizeText ?? {}} errors={errors} locales={locales} />
                    <LocalizedField name="birthText" label={t('birthText')} size="s" value={animal?.birthText ?? {}} errors={errors} locales={locales} />
                  </FormGrid>
                </div>
              </section>
              <section className="mt-5 border-t border-line pt-5">
                <h3 className="text-[15px] font-semibold">{t('sections.stay')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="location" label={t('location')} size="s"><Select id="location" name="location" defaultValue={animal?.location ?? 'shelter'}><option value="shelter">{t('locations.shelter')}</option><option value="germany">{t('locations.germany')}</option></Select></FormField>
                    <FormField id="place" label={t('place')} size="s" error={errors.place}><Input id="place" name="place" placeholder={t('placePlaceholder')} defaultValue={animal?.place ?? ''} /></FormField>
                    <FormField id="externalProfileUrl" label={t('externalProfileUrl')} hint={t('externalHint')} error={errors.externalProfileUrl}><Input id="externalProfileUrl" name="externalProfileUrl" defaultValue={animal?.externalProfileUrl ?? ''} /></FormField>
                  </FormGrid>
                </div>
              </section>
              <section className="mt-5 border-t border-line pt-5">
                <h3 className="text-[15px] font-semibold">{t('sections.flags')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="isEmergency" label={t('isEmergency')} toggle><Checkbox id="isEmergency" name="isEmergency" defaultChecked={animal?.isEmergency ?? false} /></FormField>
                    <FormField id="isSponsorable" label={t('isSponsorable')} toggle><Checkbox id="isSponsorable" name="isSponsorable" defaultChecked={animal?.isSponsorable ?? false} /></FormField>
                  </FormGrid>
                </div>
              </section>
            </TabsContent>
            {/*
              Texte links, Fotos rechts: Wer prüft, sieht beides nebeneinander und speichert einmal. Eigenes Zwei-Block-
              Layout nur für diesen Reiter (Plan K8/K9 T2b): ab 880 px Kartenbreite nebeneinander, je halbe Breite,
              darunter untereinander. Jeder Block rastert in seinem eigenen `FormGrid`.
            */}
            <TabsContent keepMounted value="content" className="p-5">
              <div className="@container">
                <div className="grid grid-cols-1 gap-x-5 gap-y-4 @[880px]:grid-cols-2">
                  {/* Der Texte-Block ist eine eigene Spalte (~570 px): Jedes Feld darin nimmt die volle Blockbreite,
                      auch bei einer Sprache; mehrere Sprachen teilen sie sich (HANDOFF Konsistenz § 8c). */}
                  <section className="flex min-w-0 flex-col">
                    <h3 className="text-[15px] font-semibold">{t('sections.texts')}</h3>
                    <div className="mt-3">
                      <FormGrid>
                        <LocalizedField name="summary" label={t('summary')} size="full" kind="textarea" rows={2} value={animal?.summary ?? {}} errors={errors} locales={locales} />
                        <LocalizedField name="body" label={t('body')} size="full" kind="markdown" rows={10} value={animal?.body ?? {}} errors={errors} locales={locales} />
                        <LocalizedField name="traits__text" label={t('traits')} size="full" hint={t('traitsHint')} value={Object.fromEntries(locales.map((l) => [l, ((animal?.traits as Record<string, string[]> | undefined)?.[l] ?? []).join(', ')]))} locales={locales} />
                      </FormGrid>
                    </div>
                  </section>
                  <section className="flex min-w-0 flex-col">
                    <h3 className="text-[15px] font-semibold">{t('sections.photos')}</h3>
                    <div className="mt-3">
                      <FormGrid>
                        <FormCell size="full">
                          {animal ? <PhotosEditor photos={photos} max={maxPhotos} error={errors.photos} onChange={changePhotos} onChoose={() => setChooserOpen(true)} frame={photoFrame} /> : <p className="h-fit rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2">{p('afterCreate')}</p>}
                        </FormCell>
                      </FormGrid>
                    </div>
                  </section>
                </div>
              </div>
            </TabsContent>
            <TabsContent keepMounted value="story" className="p-5">{animal ? <StoryFields animal={animal} locales={locales} errors={errors} onMediaChange={hiddenEdited} /> : null}</TabsContent>
            {/* Eine Leiste für alle Reiter: Sie zählt und speichert, was auf irgendeinem von ihnen geändert wurde. */}
            {/* „Speichern“ steht im DOM zuerst: Die Eingabetaste in einem Feld speichert nur, sie bestätigt nichts. */}
            <FormActionBar
              // Hat die Leiste einen Hauptweg über „Speichern und weiter“, geht der auch ohne Änderung weiter: nie „Nichts geändert“.
              mode={animal && !primary ? 'edit' : 'create'}
              state={state}
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
      </FormCard>
      {/* Außerhalb des Formulars: Ein Dialog ist ein React-Portal, und was darin geschieht, stiege sonst ins Formular auf. */}
      {animal ? <MediaChooserDialog open={chooserOpen} onOpenChange={setChooserOpen} kind="image" multiple max={maxPhotos} selected={photos.map((x) => x.assetId)} onConfirm={(ids) => changePhotos(mergePhotos(photos, ids))} /> : null}
    </div>
  );
}
