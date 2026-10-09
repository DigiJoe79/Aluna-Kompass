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

const SETTING = 'backup.maxAgeDays';

/**
 * Die Frist, ab der die Startseite ein Backup als veraltet meldet (`backup.maxAgeDays`). Eine Karte, die
 * Leiste ihr letztes Kind (MUSTER § B/E); ohne `settings.manage` nur zu lesen.
 */
export function MaxAgeSettings({ maxAgeDays, canManage }: { maxAgeDays: number; canManage: boolean }) {
  const t = useTranslations('backup.settings');
  const titleId = useId();
  const [saves, setSaves] = useState(0);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (_prev, formData) => {
      const n = parseInt(String(formData.get(SETTING)), 10);
      const result = await saveSettingsAction({ [SETTING]: Number.isNaN(n) ? maxAgeDays : n });
      return result.status === 'success' ? { ...result, message: t('saved') } : result;
    },
    { status: 'idle' },
  );

  useEffect(() => {
    if (state.status !== 'success') return;
    toast.success(state.message ?? '');
    setSaves((n) => n + 1);
  }, [state]);

  const error = state.status === 'error' ? state.fieldErrors[SETTING] : undefined;
  return (
    <FormCard as="section" aria-labelledby={titleId}>
      <ActionForm action={formAction} state={state}>
        <div className="flex flex-col gap-3 p-5">
          <h3 id={titleId} className="text-[15px] font-semibold">{t('title')}</h3>
          <FormGrid>
            <FormField id="backup-max-age" label={t('maxAgeDays')} hint={t('maxAgeDaysHint')} error={error} size="s">
              <div className="flex items-center gap-2">
                <Input id="backup-max-age" name={SETTING} type="number" min={1} max={365} defaultValue={maxAgeDays} readOnly={!canManage} className="w-24 font-mono" />
                <span className="text-[13px] text-muted-ink">{t('days')}</span>
              </div>
            </FormField>
          </FormGrid>
        </div>
        {canManage ? <FormActionBar baseline={saves} state={withUnplacedFieldErrors(state, [SETTING])} /> : null}
      </ActionForm>
    </FormCard>
  );
}
