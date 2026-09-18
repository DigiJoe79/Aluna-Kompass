'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';
import { saveSettingsAction } from '../settings/actions';

/** Die Frist, ab der die Startseite ein Backup als veraltet meldet (`backup.maxAgeDays`). */
export function MaxAgeSettings({ maxAgeDays, canManage }: { maxAgeDays: number; canManage: boolean }) {
  const t = useTranslations('backup.settings');
  const tc = useTranslations('common');
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    async (_prev, formData) => {
      const n = parseInt(String(formData.get('backup.maxAgeDays')), 10);
      const result = await saveSettingsAction({ 'backup.maxAgeDays': Number.isNaN(n) ? maxAgeDays : n });
      return result.status === 'success' ? { ...result, message: t('saved') } : result;
    },
    { status: 'idle' },
  );

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h3 className="font-heading text-[18px]">{t('title')}</h3>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <label htmlFor="backup-max-age" className="text-[13px] font-medium text-ink">{t('maxAgeDays')}</label>
        <p className="text-[11px] text-muted-ink">{t('maxAgeDaysHint')}</p>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Input id="backup-max-age" name="backup.maxAgeDays" type="number" min={1} max={365} defaultValue={maxAgeDays} className="w-24 font-mono" disabled={isPending} />
            <span className="text-[13px] text-muted-ink">{t('days')}</span>
            <Button type="submit" variant="secondary" disabled={isPending}>{tc('save')}</Button>
          </div>
        ) : (
          <p className="font-mono text-[13px] text-ink">{maxAgeDays} {t('days')}</p>
        )}
        {state.status === 'success' && state.message ? <p className="text-[13px] text-ink-2">{state.message}</p> : null}
        {state.status === 'error' ? <p className="text-[13px] text-error">{state.message}</p> : null}
      </form>
    </section>
  );
}
