'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveFactsAction } from './actions';

type Values = Record<string, unknown>;
type Option = { slug: string; name: string };

function StringList({ label, itemLabel, add, values, onChange }: { label: string; itemLabel: (i: number) => string; add: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={itemLabel(i)} value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => onChange([...values, ''])}>{add}</Button>
    </div>
  );
}

export function FactsForm({ initial, animals, stories, locales }: { initial: Values; animals: Option[]; stories: Option[]; locales: string[] }) {
  const t = useTranslations('website.facts');
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();
  const changes = useMemo(() => Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k]))), [values, initial]);
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  const str = (key: string) => String(values[key] ?? '');
  const list = (key: string) => (values[key] as string[]) ?? [];
  const claim = (values['website.claim'] as Record<string, string>) ?? {};
  const links = (values['website.socialLinks'] as { label: string; href: string }[]) ?? [];
  const select = 'h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]';
  const num = (key: string, label: string, step = '1') => (
    <FormField id={key} label={label} error={errors[key]}>
      <Input id={key} type="number" step={step} value={str(key)} onChange={(e) => set(key, e.target.value === '' ? 0 : Number(e.target.value))} className="font-mono" />
    </FormField>
  );

  return (
    <div className="flex flex-col">
      <section className="grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.presence')}</h3>
        {locales.map((loc) => (
          <FormField key={loc} id={`claim-${loc}`} label={`${t('fields.claim')} (${loc.toUpperCase()})`} error={loc === locales[0] ? errors['website.claim'] : undefined}>
            <Input id={`claim-${loc}`} value={claim[loc] ?? ''} onChange={(e) => set('website.claim', { ...claim, [loc]: e.target.value })} />
          </FormField>
        ))}
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.numbers')}</h3>
        {num('website.forwardingPercent', t('fields.forwardingPercent'), '0.1')}
        {num('website.shelterDogCount', t('fields.shelterDogCount'))}
        <FormField id="section11" label={t('fields.section11Status')}>
          <select id="section11" value={str('website.section11Status')} onChange={(e) => set('website.section11Status', e.target.value)} className={select}>
            <option value="pending">{t('section11.pending')}</option>
            <option value="granted">{t('section11.granted')}</option>
          </select>
        </FormField>
        <FormField id="section11Date" label={t('fields.section11Date')} error={errors['website.section11Date']}>
          <Input id="section11Date" type="date" value={str('website.section11Date')} onChange={(e) => set('website.section11Date', e.target.value)} className="font-mono" />
        </FormField>
        <StringList label={t('fields.donationBoxLocations')} itemLabel={(i) => t('fields.location', { n: i + 1 })} add={t('addLocation')} values={list('website.donationBoxLocations')} onChange={(v) => set('website.donationBoxLocations', v)} />
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.donations')}</h3>
        <FormField id="bpMeta" label={t('fields.betterplaceMetaProjectId')} error={errors['website.betterplaceMetaProjectId']}>
          <Input id="bpMeta" value={str('website.betterplaceMetaProjectId')} onChange={(e) => set('website.betterplaceMetaProjectId', e.target.value)} className="font-mono" />
        </FormField>
        {num('website.betterplaceDefaultAmount', t('fields.betterplaceDefaultAmount'))}
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.home')}</h3>
        <FormField id="featuredAnimal" label={t('fields.featuredAnimalSlug')} hint={t('autoHint')}>
          <select id="featuredAnimal" value={str('website.featuredAnimalSlug')} onChange={(e) => set('website.featuredAnimalSlug', e.target.value)} className={select}>
            <option value="auto">{t('auto')}</option>
            {animals.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        </FormField>
        <FormField id="featuredStory" label={t('fields.featuredStorySlug')} hint={t('autoHint')}>
          <select id="featuredStory" value={str('website.featuredStorySlug')} onChange={(e) => set('website.featuredStorySlug', e.target.value)} className={select}>
            <option value="auto">{t('auto')}</option>
            {stories.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        </FormField>
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.social')}</h3>
        {links.map((l, i) => (
          <div key={i} className="flex gap-2 md:col-span-2">
            <Input aria-label={t('fields.socialLabel', { n: i + 1 })} value={l.label} onChange={(e) => set('website.socialLinks', links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="w-40" />
            <Input aria-label={t('fields.socialHref', { n: i + 1 })} value={l.href} onChange={(e) => set('website.socialLinks', links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} />
            <Button type="button" variant="ghost" onClick={() => set('website.socialLinks', links.filter((_, j) => j !== i))}>×</Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => set('website.socialLinks', [...links, { label: '', href: 'https://' }])}>{t('addSocial')}</Button>
      </section>
      <section className="mt-4 grid gap-4 rounded-lg border border-warning bg-surface p-6 md:grid-cols-2">
        <h3 className="font-heading text-[17px] md:col-span-2">{t('groups.confidentiality')}</h3>
        <p className="text-[13px] text-ink-2 md:col-span-2">{t('blockedHint')}</p>
        <StringList label={t('fields.blockedTerms')} itemLabel={(i) => t('fields.blockedTerm', { n: i + 1 })} add={t('addBlocked')} values={list('website.blockedTerms')} onChange={(v) => set('website.blockedTerms', v)} />
      </section>
      <SaveBar
        pendingCount={Object.keys(changes).length}
        saving={saving}
        onDiscard={() => { setValues(initial); setErrors({}); }}
        onSave={() => start(async () => {
          const s = await saveFactsAction(changes);
          if (s.status === 'error') {
            setErrors(s.fieldErrors);
            toast.error(s.message);
          } else {
            toast.success(s.status === 'success' ? s.message ?? '' : '');
            setErrors({});
          }
        })}
      />
    </div>
  );
}
