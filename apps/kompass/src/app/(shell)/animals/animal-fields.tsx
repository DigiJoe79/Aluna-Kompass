'use client';

import type { AnimalRecord } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { FixedValue } from '@/components/fixed-value';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { LocalizedField } from '@/components/forms/localized-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Section } from '@/components/section';

type Values = Partial<AnimalRecord>;

/**
 * Die Felder der Reiter Profil und Inhalt (ohne Fotos und Geschichte), geteilt von der Tier-Maske und der
 * Prüfseite eines neuen Hundes (Spec Vorschläge § 6: dieselbe Maske, vorbefüllt). `marks`: Felder mit
 * Zweifelsfall der Quelle — sie tragen den Hinweis darauf (die Spalte daneben nennt ihn).
 */
export function ProfileFields({ values, slug, locales, errors, marks }: { values: Values; slug?: string; locales: string[]; errors: Record<string, string>; marks?: ReadonlySet<string> }) {
  const t = useTranslations('animals.form');
  const c = useTranslations('content');
  const mark = (field: string) => (marks?.has(field) ? t('hintMark') : undefined);
  return (
    <>
      <Section title={t('sections.name')}>
        <FormGrid>
          {slug !== undefined ? (
            // Fest seit dem Anlegen (Spec „Tier-Slug fest“): kein `name`, also reist er nicht mit dem Speichern.
            <FixedValue id="slug" testId="animal-slug" label={c('slug')} value={slug} reason={t('slugFixed')} mono />
          ) : null}
          <FormField id="name" hint={mark('name')} label={t('name')} error={errors.name} required><Input id="name" name="name" defaultValue={values.name ?? ''} required /></FormField>
        </FormGrid>
      </Section>
      <Section title={t('sections.traits')}>
        <FormGrid>
          <FormField id="sex" hint={mark('sex')} label={t('sex')} size="s"><Select id="sex" name="sex" defaultValue={values.sex ?? 'female'}><option value="female">{t('sexes.female')}</option><option value="male">{t('sexes.male')}</option></Select></FormField>
          <FormField id="sizeCm" hint={mark('sizeCm')} label={t('sizeCm')} error={errors.sizeCm} size="s"><Input id="sizeCm" name="sizeCm" type="number" defaultValue={values.sizeCm ?? 0} /></FormField>
          <LocalizedField name="sizeText" hint={mark('sizeText')} label={t('sizeText')} size="s" value={values.sizeText ?? {}} errors={errors} locales={locales} />
          <LocalizedField name="birthText" hint={mark('birthText')} label={t('birthText')} size="s" value={values.birthText ?? {}} errors={errors} locales={locales} />
        </FormGrid>
      </Section>
      <Section title={t('sections.stay')}>
        <FormGrid>
          <FormField id="location" hint={mark('location')} label={t('location')} size="s"><Select id="location" name="location" defaultValue={values.location ?? 'shelter'}><option value="shelter">{t('locations.shelter')}</option><option value="germany">{t('locations.germany')}</option></Select></FormField>
          <FormField id="place" hint={mark('place')} label={t('place')} size="s" error={errors.place}><Input id="place" name="place" placeholder={t('placePlaceholder')} defaultValue={values.place ?? ''} /></FormField>
          <FormField id="externalProfileUrl" label={t('externalProfileUrl')} hint={mark('externalProfileUrl') ?? t('externalHint')} error={errors.externalProfileUrl}><Input id="externalProfileUrl" name="externalProfileUrl" defaultValue={values.externalProfileUrl ?? ''} /></FormField>
        </FormGrid>
      </Section>
      <Section title={t('sections.flags')}>
        <FormGrid>
          <FormField id="isEmergency" hint={mark('isEmergency')} label={t('isEmergency')} toggle><Checkbox id="isEmergency" name="isEmergency" defaultChecked={values.isEmergency ?? false} /></FormField>
          <FormField id="isSponsorable" hint={mark('isSponsorable')} label={t('isSponsorable')} toggle><Checkbox id="isSponsorable" name="isSponsorable" defaultChecked={values.isSponsorable ?? false} /></FormField>
        </FormGrid>
      </Section>
    </>
  );
}

export function TextFields({ values, locales, errors, marks }: { values: Values; locales: string[]; errors: Record<string, string>; marks?: ReadonlySet<string> }) {
  const t = useTranslations('animals.form');
  const mark = (field: string) => (marks?.has(field) ? t('hintMark') : undefined);
  return (
    <div className="flex min-w-0 flex-col">
      <Section title={t('sections.texts')}>
        <FormGrid>
          <LocalizedField name="summary" hint={mark('summary')} label={t('summary')} size="full" kind="textarea" rows={2} value={values.summary ?? {}} errors={errors} locales={locales} />
          <LocalizedField name="body" hint={mark('body')} label={t('body')} size="full" kind="markdown" rows={10} value={values.body ?? {}} errors={errors} locales={locales} />
          <LocalizedField name="traits__text" label={t('traits')} size="full" hint={mark('traits') ?? t('traitsHint')} value={Object.fromEntries(locales.map((l) => [l, ((values.traits as Record<string, string[]> | undefined)?.[l] ?? []).join(', ')]))} locales={locales} />
        </FormGrid>
      </Section>
    </div>
  );
}
