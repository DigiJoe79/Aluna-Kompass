'use client';

import type { ExternalLink } from '@kompass/module-projects';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Verweise nach aussen als Liste aus Bezeichnung und Adresse. Die Felder
 * heissen `externalLinks.<n>.label` und `.url`; die Action liest sie in der
 * Reihenfolge ein, Fehler kommen unter demselben Pfad zurück.
 */
export function ExternalLinksField({ value, errors }: { value: ExternalLink[]; errors: Record<string, string> }) {
  const t = useTranslations('projects.form.links');
  const [links, setLinks] = useState<ExternalLink[]>(value);
  const update = (index: number, patch: Partial<ExternalLink>) => setLinks(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  return (
    <fieldset className="md:col-span-2 flex flex-col gap-3">
      <legend className="text-[13px] font-semibold">{t('title')}</legend>
      <p className="text-[12px] text-muted-ink">{t('hint')}</p>
      {links.length === 0 ? <p className="text-[13px] text-muted-ink">{t('empty')}</p> : null}
      {links.map((link, index) => (
        <div key={index} className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <FormField id={`externalLinks.${index}.label`} label={t('label')} error={errors[`externalLinks.${index}.label`]}>
            <Input id={`externalLinks.${index}.label`} name={`externalLinks.${index}.label`} value={link.label} onChange={(e) => update(index, { label: e.target.value })} />
          </FormField>
          <FormField id={`externalLinks.${index}.url`} label={t('url')} error={errors[`externalLinks.${index}.url`]}>
            <Input id={`externalLinks.${index}.url`} name={`externalLinks.${index}.url`} value={link.url} onChange={(e) => update(index, { url: e.target.value })} className="font-mono" />
          </FormField>
          <Button type="button" variant="outline" aria-label={t('remove')} onClick={() => setLinks(links.filter((_, i) => i !== index))}>×</Button>
        </div>
      ))}
      <div><Button type="button" variant="outline" onClick={() => setLinks([...links, { label: '', url: '' }])}>{t('add')}</Button></div>
    </fieldset>
  );
}
