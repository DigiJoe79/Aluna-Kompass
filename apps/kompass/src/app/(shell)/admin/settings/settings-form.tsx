'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormErrorSummary } from '@/components/forms/form-error-summary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SETTINGS_TABS, TAX_REQUIRED, type SettingsField } from '@/lib/settings-fields';
import { cn } from '@/lib/utils';
import { LogoUpload } from './logo-upload';
import { saveSettingsAction } from './actions';

type Values = Record<string, unknown>;

export function SettingsForm({
  initial,
  themes,
  lastSaved,
}: {
  initial: Values;
  themes: { key: string; name: string }[];
  lastSaved: string | null;
}) {
  const t = useTranslations('settings');
  const c = useTranslations('common');
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();

  const changes = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k])),
    [values, initial]
  );
  const pendingCount = Object.keys(changes).length;
  const invalidTabs = new Set(
    SETTINGS_TABS.filter((tab) => tab.fields.some((f) => errors[f.key])).map((tab) => tab.key)
  );
  const taxMissing = TAX_REQUIRED.filter((k) => !values[k] || values[k] === 'none').length;

  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
  };

  const render = (field: SettingsField) => {
    const label = t(`fields.${field.key}`);
    const value = values[field.key];
    const id = field.key.replace('.', '-');
    const common = { id, className: cn(field.kind === 'mono' && 'font-mono') };
    const hint = field.hintKey ? t(`hints.${field.hintKey}`) : undefined;
    const wrap = (node: React.ReactNode, extraHint?: string) => (
      <FormField
        key={field.key}
        id={id}
        label={label}
        hint={extraHint ?? hint}
        error={errors[field.key]}
        className={field.span === 'full' ? 'md:col-span-2' : undefined}
      >
        {node}
      </FormField>
    );

    switch (field.kind) {
      case 'textarea': {
        const text = String(value ?? '');
        return wrap(
          <Textarea
            id={id}
            rows={4}
            maxLength={field.maxLength}
            value={text}
            onChange={(e) => set(field.key, e.target.value)}
            aria-invalid={!!errors[field.key] || undefined}
          />,
          `${t('counter', { count: text.length, max: field.maxLength ?? 0 })} ${hint ?? ''}`.trim()
        );
      }
      case 'select':
      case 'font-body':
      case 'font-heading':
        return wrap(
          <Select id={id} value={String(value ?? '')} onChange={(e) => set(field.key, e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {t(`options.${field.key}.${o}`)}
              </option>
            ))}
          </Select>
        );
      case 'theme':
        return wrap(
          <Select id={id} value={String(value ?? 'default')} onChange={(e) => set(field.key, e.target.value)}>
            {themes.map((th) => (
              <option key={th.key} value={th.key}>
                {th.name}
              </option>
            ))}
          </Select>,
          t('hints.themeHint')
        );
      case 'date':
        return wrap(
          <Input
            {...common}
            type="date"
            value={String(value ?? '')}
            onChange={(e) => set(field.key, e.target.value)}
            className="font-mono"
            aria-invalid={!!errors[field.key] || undefined}
          />
        );
      default:
        return wrap(
          <Input
            {...common}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => set(field.key, e.target.value)}
            aria-invalid={!!errors[field.key] || undefined}
          />
        );
    }
  };

  const save = () =>
    start(async () => {
      const state = await saveSettingsAction(changes);
      if (state.status === 'error') {
        setErrors(state.fieldErrors);
        toast.error(state.message);
        return;
      }
      toast.success(state.status === 'success' ? state.message ?? '' : '');
      setErrors({});
    });

  return (
    <>
    <FormErrorSummary errors={errors} />
    <Tabs defaultValue="organization">
      <TabsList className="border-b border-line bg-surface px-6">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            data-invalid={invalidTabs.has(tab.key) ? 'true' : undefined}
            className="gap-2 data-[state=active]:font-semibold data-[state=active]:shadow-[inset_0_-2px_0_var(--color-primary)] data-active:font-semibold data-active:shadow-[inset_0_-2px_0_var(--color-primary)]"
          >
            {t(`tabs.${tab.key}`)}
            {invalidTabs.has(tab.key) ? (
              <span className="size-[7px] rounded-full bg-error" aria-label={t('tabInvalid')} />
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {SETTINGS_TABS.map((tab) => (
        <TabsContent key={tab.key} value={tab.key} className="p-6">
          {tab.key === 'tax' && taxMissing > 0 ? (
            <p
              role="alert"
              className="mb-4 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2"
            >
              <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="font-semibold text-warning">
                  {t('taxIncomplete', { count: taxMissing })}
                </span>{' '}
                {t('taxIncompleteText')}
              </span>
            </p>
          ) : null}
          {tab.key === 'branding' ? <LogoUpload currentAssetId={String(values['branding.logoAssetId'] ?? '') || null} /> : null}
          <div className="grid gap-x-6 gap-y-4 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
            {tab.fields.map(render)}
          </div>
        </TabsContent>
      ))}
      <SaveBar
        pendingCount={pendingCount}
        saving={saving}
        info={lastSaved ? c('lastSaved', { date: lastSaved, name: '' }) : undefined}
        onDiscard={() => {
          setValues(initial);
          setErrors({});
        }}
        onSave={save}
      />
    </Tabs>
    </>
  );
}
