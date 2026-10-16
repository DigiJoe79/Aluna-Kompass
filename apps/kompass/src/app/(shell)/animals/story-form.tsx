'use client';

import type { ResolvedImagePlaces } from '@kompass/core/image-places';
import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/section';

/**
 * Die Felder der Erfolgsgeschichte. Kein eigenes Formular: Sie stehen in dem der Maske und werden mit deren
 * „Speichern“ geschrieben, egal auf welchem Reiter man es drückt.
 *
 * Auch vor der Vermittlung stehen die Felder im Formular, nur unsichtbar: Kämen sie erst mit dem Statuswechsel
 * dazu, zählte die Speicherleiste jedes von ihnen als ungespeicherte Änderung. Die Action schreibt die
 * Geschichte nur bei einem vermittelten Hund.
 *
 * Das Jahr setzt schon „Status ändern“, während die Maske stehen bleibt. Ein ungesteuertes Feld übernähme
 * den neuen `defaultValue` nicht, und ein folgendes Speichern schriebe das alte Jahr zurück: `key` aus dem
 * Ladestand baut es neu auf, und die Speicherleiste zieht es nach (`loadedVersion`).
 */
export function StoryFields({ animal, locales, errors, onMediaChange, places, sizes }: { animal: AnimalRecord; locales: string[]; errors: Record<string, string>; onMediaChange: () => void; places?: ResolvedImagePlaces; sizes?: Readonly<Record<string, { width: number; height: number }>> }) {
  const t = useTranslations('animals.story');
  const tc = useTranslations('media.crop');
  // Vorher und Nachher sind Stellen der Webseite (`animals.story`): Ausschnitt im Format der Geschichte, gespeichert mit dem Tier.
  const crop = places ? { places, sizes: sizes ?? {}, target: tc('targets.animal'), onCropChange: onMediaChange } : {};
  const story = animal.story;
  const adopted = animal.status === 'adopted';
  return (
    <>
      {adopted ? null : <p className="rounded-md border border-line bg-surface-2 p-4 text-meta text-ink-2">{t('locked')}</p>}
      <div className={adopted ? undefined : 'hidden'}>
        <Section title={t('sections.images')}>
          <FormGrid>
            <FormCell size="m"><MediaPicker name="beforeAssetId" value={story?.beforeAssetId ?? null} label={t('before')} onChange={onMediaChange} crop={story?.beforeCrop ?? null} cropName="beforeCrop" {...crop} /></FormCell>
            <FormCell size="m"><MediaPicker name="afterAssetId" value={story?.afterAssetId ?? null} label={t('after')} onChange={onMediaChange} crop={story?.afterCrop ?? null} cropName="afterCrop" {...crop} /></FormCell>
            <LocalizedField name="beforeCaption" label={t('beforeCaption')} hint={t('captionHint')} value={story?.beforeCaption ?? {}} errors={errors} locales={locales} />
            <LocalizedField name="afterCaption" label={t('afterCaption')} hint={t('captionHint')} value={story?.afterCaption ?? {}} errors={errors} locales={locales} />
          </FormGrid>
        </Section>
        <Section title={t('sections.family')}>
          <FormGrid>
            <FormField id="family" label={t('family')} error={errors.family}><Input id="family" name="family" defaultValue={story?.family ?? ''} /></FormField>
            <FormField id="adoptedYear" label={t('year')} error={errors.adoptedYear} size="s"><Input key={animal.updatedAt} id="adoptedYear" name="adoptedYear" type="number" defaultValue={story?.adoptedYear ?? new Date().getFullYear()} /></FormField>
            <LocalizedField name="quote" label={t('quote')} kind="textarea" rows={3} value={story?.quote ?? {}} errors={errors} locales={locales} />
          </FormGrid>
        </Section>
      </div>
    </>
  );
}
