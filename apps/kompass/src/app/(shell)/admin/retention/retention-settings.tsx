'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveSettingsAction } from '../settings/actions';
import type { ActionState } from '@/lib/actions';

interface Props {
  statutory10Y: number;
  statutory6Y: number;
  consent: number;
  canManage: boolean;
}

export function RetentionSettings({ statutory10Y, statutory6Y, consent, canManage }: Props) {
  const t = useTranslations('retention.settings');
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    async (_prev, formData) => {
      const v10 = parseInt(String(formData.get('retention.statutory10Y')), 10);
      const v6 = parseInt(String(formData.get('retention.statutory6Y')), 10);
      const vc = parseInt(String(formData.get('retention.consent')), 10);
      return saveSettingsAction({
        'retention.statutory10Y': isNaN(v10) ? statutory10Y : v10,
        'retention.statutory6Y': isNaN(v6) ? statutory6Y : v6,
        'retention.consent': isNaN(vc) ? consent : vc,
      });
    },
    { status: 'idle' },
  );

  return (
    <section className="mb-6 rounded-md border border-line bg-surface p-4">
      <h2 className="mb-3 text-[14px] font-semibold text-ink">{t('title')}</h2>
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="statutory10Y" className="block text-[13px] font-medium text-ink">
              {t('statutory10Y')}
            </label>
            <p className="mb-1.5 text-[11px] text-muted-ink">{t('statutory10YHint')}</p>
            {canManage ? (
              <div className="flex items-center gap-2">
                <Input
                  id="statutory10Y"
                  name="retention.statutory10Y"
                  type="number"
                  min={0}
                  defaultValue={statutory10Y}
                  className="w-24 font-mono"
                  disabled={isPending}
                />
                <span className="text-[13px] text-muted-ink">Monate</span>
              </div>
            ) : (
              <p className="font-mono text-[13px] text-ink">{statutory10Y} Monate</p>
            )}
          </div>

          <div>
            <label htmlFor="statutory6Y" className="block text-[13px] font-medium text-ink">
              {t('statutory6Y')}
            </label>
            <p className="mb-1.5 text-[11px] text-muted-ink">{t('statutory6YHint')}</p>
            {canManage ? (
              <div className="flex items-center gap-2">
                <Input
                  id="statutory6Y"
                  name="retention.statutory6Y"
                  type="number"
                  min={0}
                  defaultValue={statutory6Y}
                  className="w-24 font-mono"
                  disabled={isPending}
                />
                <span className="text-[13px] text-muted-ink">Monate</span>
              </div>
            ) : (
              <p className="font-mono text-[13px] text-ink">{statutory6Y} Monate</p>
            )}
          </div>

          <div>
            <label htmlFor="consent" className="block text-[13px] font-medium text-ink">
              {t('consent')}
            </label>
            <p className="mb-1.5 text-[11px] text-muted-ink">{t('consentHint')}</p>
            {canManage ? (
              <div className="flex items-center gap-2">
                <Input
                  id="consent"
                  name="retention.consent"
                  type="number"
                  min={0}
                  defaultValue={consent}
                  className="w-24 font-mono"
                  disabled={isPending}
                />
                <span className="text-[13px] text-muted-ink">Monate</span>
              </div>
            ) : (
              <p className="font-mono text-[13px] text-ink">{consent} Monate</p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={isPending} size="sm">
              {t('save')}
            </Button>
            {state.status === 'success' && <span className="text-[12px] text-muted-ink">{state.message}</span>}
            {state.status === 'error' && <span className="text-[12px] text-destructive">{state.message}</span>}
          </div>
        )}
      </form>
    </section>
  );
}
