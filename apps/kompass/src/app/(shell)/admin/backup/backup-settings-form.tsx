'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { CountField } from '@/components/count-field';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';
import { ringHint } from '@/lib/backup-view';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { formatSize } from '@/lib/format-size';
import { AgentSwitchSection } from '../agent-switch-section';
import { saveSettingsAction } from '../settings/actions';
import { ScheduleSwitch } from './schedule-switch';

const KEYS = {
  enabled: 'backup.schedule.enabled',
  time: 'backup.schedule.time',
  daily: 'backup.ring.daily',
  weekly: 'backup.ring.weekly',
  monthly: 'backup.ring.monthly',
  maxAgeDays: 'backup.maxAgeDays',
  agentAllowed: 'backup.mcpHumanOnlyAllowed',
} as const;
type Values = { enabled: boolean; time: string; daily: number; weekly: number; monthly: number; maxAgeDays: number; agentAllowed: boolean };
type RingKey = 'daily' | 'weekly' | 'monthly';
/** Grenzen wie die Schemas der Einstellungen (`packages/core/src/settings/core.ts`). */
const RING: { key: RingKey; min: number; max: number }[] = [
  { key: 'daily', min: 1, max: 60 },
  { key: 'weekly', min: 0, max: 52 },
  { key: 'monthly', min: 0, max: 120 },
];
const PLACED = Object.values(KEYS) as string[];

/** Was die Maske gerade sagt, gelesen aus dem Formular; ungültige Zahlen bleiben beim gespeicherten Wert. */
function read(form: FormData, values: Values): Values {
  const int = (key: string, fallback: number) => {
    const n = parseInt(String(form.get(key) ?? ''), 10);
    return Number.isNaN(n) ? fallback : n;
  };
  return {
    enabled: form.get(KEYS.enabled) === 'on',
    time: String(form.get(KEYS.time) ?? values.time) || values.time,
    daily: int(KEYS.daily, values.daily),
    weekly: int(KEYS.weekly, values.weekly),
    monthly: int(KEYS.monthly, values.monthly),
    maxAgeDays: int(KEYS.maxAgeDays, values.maxAgeDays),
    agentAllowed: form.get(KEYS.agentAllowed) === 'on',
  };
}

/**
 * Reiter „Einstellungen“ der Backup-Seite (Board 1d): eine Karte mit „Automatisch sichern“ (Zeitplan, Uhrzeit, Ring
 * mit Hinweis), „Frist“ und dem Agentenschalter als letztem Abschnitt, darunter die Speicherleiste. Gespeichert wird
 * nur, was sich geändert hat, in einem Aufruf. Ohne `settings.manage` nur zu lesen, ohne Leiste.
 */
export function BackupSettingsForm({ values, referenceBytes, mailAvailable, canManage }: { values: Values; referenceBytes: number | null; mailAvailable: boolean; canManage: boolean }) {
  const t = useTranslations('backup.settings');
  const [saves, setSaves] = useState(0);
  const [ring, setRing] = useState({ daily: values.daily, weekly: values.weekly, monthly: values.monthly });
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (_prev, form) => {
      const next = read(form, values);
      const changed = Object.fromEntries((Object.keys(KEYS) as (keyof Values)[]).filter((k) => next[k] !== values[k]).map((k) => [KEYS[k], next[k]]));
      const result = await saveSettingsAction(changed);
      return result.status === 'success' ? { ...result, message: t('saved') } : result;
    },
    { status: 'idle' },
  );

  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message ?? '');
    setSaves((n) => n + 1);
  }, [state]);

  const errors = state.status === 'error' ? state.fieldErrors : {};
  const hint = ringHint(ring, referenceBytes);
  return (
    <FormCard>
      <ActionForm action={formAction} state={state}>
        <div className="p-5">
          <Section title={t('schedule.title')}>
            <FormGrid>
              <ScheduleSwitch name={KEYS.enabled} label={t('schedule.enabled')} hint={mailAvailable ? t('schedule.hintMail') : t('schedule.hintNoMail')} error={errors[KEYS.enabled]} checked={values.enabled} disabled={!canManage} />
              <FormField id="backup-schedule-time" label={t('schedule.time')} error={errors[KEYS.time]} size="s">
                <Input id="backup-schedule-time" name={KEYS.time} type="time" defaultValue={values.time} disabled={!canManage} />
              </FormField>
              <FormCell as="fieldset" size="full" className="flex min-w-0 flex-col gap-1.5">
                <legend className="text-meta font-semibold text-ink-2">{t('ring.legend')}</legend>
                {/* Ring in einer Zeile, 24 px Abstand; am Telefon untereinander (Designer 2026-10-23 `zaehlfelder`, 230). */}
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
                  {RING.map(({ key, min, max }) => (
                    <CountField
                      key={key}
                      id={`backup-ring-${key}`}
                      name={KEYS[key]}
                      min={min}
                      max={max}
                      defaultValue={values[key]}
                      disabled={!canManage}
                      unit={t(`ring.${key}`)}
                      aria-label={t(`ring.${key}Label`)}
                      aria-invalid={errors[KEYS[key]] ? true : undefined}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setRing((r) => ({ ...r, [key]: Number.isNaN(n) ? 0 : n }));
                      }}
                    />
                  ))}
                </div>
                {RING.map(({ key }) => (
                  <FieldError key={key} id={`backup-ring-${key}-error`} message={errors[KEYS[key]]} />
                ))}
                <p data-testid="backup-retention-hint" className="max-w-prose text-hint text-muted-ink">
                  {t('ring.hint', {
                    count: hint.count,
                    total: hint.totalBytes === null ? 'none' : formatSize(hint.totalBytes),
                    reference: referenceBytes === null ? '' : formatSize(referenceBytes),
                  })}
                </p>
              </FormCell>
            </FormGrid>
          </Section>
          <Section title={t('maxAge.title')}>
            <FormGrid>
              <FormField id="backup-max-age" label={t('maxAge.label')} hint={t('maxAge.hint')} error={errors[KEYS.maxAgeDays]} size="s">
                <CountField id="backup-max-age" name={KEYS.maxAgeDays} min={1} max={365} defaultValue={values.maxAgeDays} disabled={!canManage} unit={t('maxAge.unit')} />
              </FormField>
            </FormGrid>
          </Section>
          <AgentSwitchSection name={KEYS.agentAllowed} label={t('agent.label')} hint={t('agent.hint')} checked={values.agentAllowed} disabled={!canManage} />
        </div>
        {canManage ? <FormActionBar baseline={saves} state={withUnplacedFieldErrors(state, PLACED)} /> : null}
      </ActionForm>
    </FormCard>
  );
}
