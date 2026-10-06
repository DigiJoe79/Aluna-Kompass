'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { Input } from '@/components/ui/input';

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
export function StoryFields({ animal, locales, errors, onMediaChange }: { animal: AnimalRecord; locales: string[]; errors: Record<string, string>; onMediaChange: () => void }) {
  const t = useTranslations('animals.story');
  const story = animal.story;
  const adopted = animal.status === 'adopted';
  return (
    <>
      {adopted ? null : <p className="rounded-md border border-line bg-surface-2 p-4 text-[13px] text-ink-2">{t('locked')}</p>}
      <div className={adopted ? undefined : 'hidden'}>
        <section>
          <h3 className="text-[15px] font-semibold">{t('sections.images')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormCell size="m"><MediaPicker name="beforeAssetId" value={story?.beforeAssetId ?? null} label={t('before')} onChange={onMediaChange} /></FormCell>
              <FormCell size="m"><MediaPicker name="afterAssetId" value={story?.afterAssetId ?? null} label={t('after')} onChange={onMediaChange} /></FormCell>
              <LocalizedField name="beforeCaption" label={t('beforeCaption')} hint={t('captionHint')} value={story?.beforeCaption ?? {}} errors={errors} locales={locales} />
              <LocalizedField name="afterCaption" label={t('afterCaption')} hint={t('captionHint')} value={story?.afterCaption ?? {}} errors={errors} locales={locales} />
            </FormGrid>
          </div>
        </section>
        <section className="mt-5 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold">{t('sections.family')}</h3>
          <div className="mt-3">
            <FormGrid>
              <FormField id="family" label={t('family')} error={errors.family}><Input id="family" name="family" defaultValue={story?.family ?? ''} /></FormField>
              <FormField id="adoptedYear" label={t('year')} error={errors.adoptedYear} size="s"><Input key={animal.updatedAt} id="adoptedYear" name="adoptedYear" type="number" defaultValue={story?.adoptedYear ?? new Date().getFullYear()} className="font-mono" /></FormField>
              <LocalizedField name="quote" label={t('quote')} kind="textarea" rows={3} value={story?.quote ?? {}} errors={errors} locales={locales} />
            </FormGrid>
          </div>
        </section>
      </div>
    </>
  );
}
