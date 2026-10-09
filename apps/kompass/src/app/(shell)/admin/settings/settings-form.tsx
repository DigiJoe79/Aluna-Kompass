'use client';

import { Section } from '@/components/section';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { FormCard } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ManagedField } from '@/components/managed-field';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormErrorSummary } from '@/components/forms/form-error-summary';
import { PanelNav } from '@/components/panel-nav';
import { Textarea } from '@/components/ui/textarea';
import { MediaPicker } from '@/components/forms/media-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { managedHintKey, managedTarget, SETTINGS_TABS, settingsSections, TAX_REQUIRED, type SettingsField } from '@/lib/settings-fields';
import { formatDate, type DateFormatMode } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { saveSettingsAction } from './actions';

const SETTINGS_TAB_KEYS = SETTINGS_TABS.map((tab) => tab.key);
type Values = Record<string, unknown>;
export type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key'];

export function SettingsForm({
  initial,
  themes,
  lastSaved,
  managed = [],
  panel,
}: {
  initial: Values;
  themes: { key: string; name: string }[];
  lastSaved: string | null;
  /** Felder, die ein eingeschaltetes Modul führt (`managedSettings`): nur lesbar, mit dem Satz, wo sie gepflegt werden. */
  managed?: string[];
  /** Der Bereich aus der Adresse (`?panel=`); die Werte aller Bereiche bleiben beim Wechsel erhalten. */
  panel: SettingsTabKey;
}) {
  const t = useTranslations('settings');
  const c = useTranslations('common');
  const { timeZone } = useDateFormat();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();
  const feedback = useActionFeedback();

  const changes = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k])),
    [values, initial]
  );
  const pendingCount = Object.keys(changes).length;
  // Die Namen für die Fehlerbox, je Einstellung unter ihrem ganzen Schlüssel (`organization.name`).
  const labels = Object.fromEntries(SETTINGS_TABS.flatMap((tab) => tab.fields).map((f) => [f.key, t(`fields.${f.key}`)]));
  const invalidTabs = new Set(
    SETTINGS_TABS.filter((tab) => tab.fields.some((f) => errors[f.key])).map((tab) => tab.key)
  );
  // E-2: der Warnkasten zählt nur nicht geführte Felder; fehlen nur geführte, verweist stattdessen ein Hinweis auf die Bescheide.
  const taxMissingUnmanaged = TAX_REQUIRED.filter((k) => !managed.includes(k) && (!values[k] || values[k] === 'none')).length;
  const taxMissingManaged = TAX_REQUIRED.filter((k) => managed.includes(k) && (!values[k] || values[k] === 'none')).length;

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
    const isManaged = managed.includes(field.key);
    const target = isManaged ? managedTarget(field.key) : null;

    // E-1: kein Eingabeelement für geführte Felder — Wert, Kennzeichen und der Weg dorthin, statt readOnly/disabled.
    if (isManaged && target) {
      // Befund 32 (0.2.1): ein Datum wie überall im Format des Vereins, nicht als ISO.
      const display = field.kind === 'select' && value ? t(`options.${field.key}.${String(value)}`) : field.kind === 'date' && value ? formatDate(String(value), (initial['ui.dateFormat'] as DateFormatMode | undefined) ?? 'locale', timeZone) : value === null || value === undefined ? '' : String(value);
      return (
        <FormCell key={field.key} size={field.size}>
          <ManagedField label={label} value={display} managedBy={{ label: t(`managedTarget.${target.targetKey}`), href: target.href }} />
        </FormCell>
      );
    }

    const hint = field.hintKey ? t(`hints.${field.hintKey}`) : undefined;
    const wrap = (node: React.ReactNode, extraHint?: string) => (
      <FormField
        key={field.key}
        id={id}
        label={label}
        hint={extraHint ?? hint}
        error={errors[field.key]}
        size={field.size}
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
            placeholder={field.placeholderKey ? t(`placeholders.${field.placeholderKey}`) : undefined}
            onChange={(e) => set(field.key, e.target.value)}
            aria-invalid={!!errors[field.key] || undefined}
          />
        );
    }
  };

  const save = (): void =>
    start(async () => {
      const state = await feedback.run(() => saveSettingsAction(changes), { retry: save });
      if (state.status === 'error') {
        setErrors(state.fieldErrors);
        return;
      }
      setErrors({});
    });

  return (
    <FormCard>
    <FormErrorSummary errors={errors} labels={labels} />
    <div className="px-6">
      <PanelNav
        basePath="/admin/settings"
        panels={SETTINGS_TAB_KEYS}
        active={panel}
        labels={Object.fromEntries(SETTINGS_TAB_KEYS.map((key) => [key, t(`tabs.${key}`)])) as Record<SettingsTabKey, string>}
        invalid={invalidTabs}
        invalidLabel={t('tabInvalid')}
        ariaLabel={t('tabsLabel')}
      />
    </div>
      {SETTINGS_TABS.filter((tab) => tab.key === panel).map((tab) => {
        const tabManagedFields = tab.fields.filter((f) => managed.includes(f.key));
        const tabManagedHintKey = tabManagedFields.length > 0 ? managedHintKey(tabManagedFields[0]!.key) : null;
        return (
        <div key={tab.key} className="p-5">
          {tabManagedHintKey ? <p className="mb-4 text-[13px] text-ink-2">{t(tabManagedHintKey)}</p> : null}
          {tab.key === 'tax' && taxMissingUnmanaged > 0 ? (
            <div className="mb-4">
              <Notice level="warn" title={t('taxIncomplete', { count: taxMissingUnmanaged })} testId="tax-incomplete">
                {t('taxIncompleteText')}
              </Notice>
            </div>
          ) : tab.key === 'tax' && taxMissingManaged > 0 ? (
            <div className="mb-4">
              <Notice level="hint">
                {t('taxNoticeMissing')}{' '}
                <Link href="/finance/donations/notices" className="font-semibold text-ink underline underline-offset-2">
                  {t('taxNoticeMissingLink')}
                </Link>
              </Notice>
            </div>
          ) : null}
          {tab.key === 'branding' ? (
            <div className="mb-5 flex flex-col gap-1 border-b border-line pb-5">
              <MediaPicker
                name="branding.logoAssetId"
                value={String(values['branding.logoAssetId'] ?? '') || null}
                label={t('logo.label')}
                onChange={(id) => set('branding.logoAssetId', id)}
              />
              <p className="text-[12px] text-ink-2">{t('logo.hint')}</p>
            </div>
          ) : null}
          {settingsSections(tab).map(({ section, fields }, index) =>
            section ? (
              <Section key={section} title={t(`sections.${section}`)}>
                <FormGrid>{fields.map(render)}</FormGrid>
              </Section>
            ) : (
              // Felder ohne Abschnitt (Bank, Anzeige): kein Titel, also keine `Section`.
              <div key={index} className={cn(index > 0 && 'mt-5 border-t border-line pt-5')}>
                <FormGrid>{fields.map(render)}</FormGrid>
              </div>
            ),
          )}
        </div>
        );
      })}
      <FormActionBar
        count={pendingCount}
        pending={saving}
        note={lastSaved ? c('lastSaved', { date: lastSaved, name: '' }) : undefined}
        state={feedback.state}
        onDiscard={() => {
          setValues(initial);
          setErrors({});
          feedback.reset();
        }}
        onSave={save}
      />
    </FormCard>
  );
}
