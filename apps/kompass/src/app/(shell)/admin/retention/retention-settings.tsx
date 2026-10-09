'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/forms/action-form';
import { FormCard } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveSettingsAction } from '../settings/actions';

interface Props {
  statutory10Y: number;
  statutory8Y: number;
  statutory6Y: number;
  consent: number;
  canManage: boolean;
}

const FIELDS = [
  { key: 'statutory10Y', hintKey: 'statutory10YHint', setting: 'retention.statutory10Y' },
  { key: 'statutory8Y', hintKey: 'statutory8YHint', setting: 'retention.statutory8Y' },
  { key: 'statutory6Y', hintKey: 'statutory6YHint', setting: 'retention.statutory6Y' },
  { key: 'consent', hintKey: 'consentHint', setting: 'retention.consent' },
] as const;

/**
 * Die Fristen der Aufbewahrung in Monaten. Eine Karte, die Leiste ihr letztes Kind (MUSTER § B/E); ohne
 * `settings.manage` sind die Felder nur zu lesen und die Leiste fehlt.
 */
export function RetentionSettings({ statutory10Y, statutory8Y, statutory6Y, consent, canManage }: Props) {
  const t = useTranslations('retention.settings');
  const titleId = useId();
  const current = { statutory10Y, statutory8Y, statutory6Y, consent };
  const [saves, setSaves] = useState(0);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (_prev, formData) => {
      const changes: Record<string, number> = {};
      for (const { key, setting } of FIELDS) {
        const n = parseInt(String(formData.get(setting)), 10);
        changes[setting] = Number.isNaN(n) ? current[key] : n;
      }
      return saveSettingsAction(changes);
    },
    { status: 'idle' },
  );

  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message ?? '');
    setSaves((n) => n + 1);
  }, [state]);

  const errors = state.status === 'error' ? state.fieldErrors : {};
  return (
    <FormCard as="section" aria-labelledby={titleId} className="mb-6">
      <ActionForm action={formAction} state={state}>
        <div className="flex flex-col gap-3 p-5">
          <h3 id={titleId} className="text-[15px] font-semibold">{t('title')}</h3>
          <FormGrid>
            {FIELDS.map(({ key, hintKey, setting }) => (
              <FormField key={key} id={key} label={t(key)} hint={t(hintKey)} error={errors[setting]} size="s">
                <div className="flex items-center gap-2">
                  <Input id={key} name={setting} type="number" min={0} defaultValue={current[key]} readOnly={!canManage} className="w-24 font-mono" />
                  <span className="text-[13px] text-muted-ink">{t('months')}</span>
                </div>
              </FormField>
            ))}
          </FormGrid>
        </div>
        {canManage ? <FormActionBar baseline={saves} state={withUnplacedFieldErrors(state, FIELDS.map(({ setting }) => setting))} /> : null}
      </ActionForm>
    </FormCard>
  );
}
