'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { applySeedAction, previewSeedAction, type SeedPreviewState } from '../actions';

export function SeedClient() {
  const t = useTranslations('site.seed');
  const [state, setState] = useState<SeedPreviewState>({ status: 'idle' });
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();

  const preview = () => start(async () => setState(await previewSeedAction()));
  const apply = () =>
    startApply(async () => {
      const result = await applySeedAction();
      if (result.status === 'success') {
        toast.success(result.message ?? '');
        setState({ status: 'idle' });
      } else if (result.status === 'error') {
        toast.error(result.message);
      }
    });

  const report = state.status === 'preview' ? state.report : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] text-ink-2">{t('intro')}</span>
        <Button type="button" onClick={preview} disabled={pending}>{t('preview')}</Button>
      </div>

      {state.status === 'error' ? (
        <p role="alert" className="text-[13px] font-semibold text-error">{state.message}</p>
      ) : null}

      {report ? (
        <section className="flex flex-col gap-3 border-t border-subtle pt-4">
          <p className="text-[13px] text-ink-2">
            {t('report', { variables: report.variables, entries: report.entries, assets: report.assets })}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={apply} disabled={applying}>{t('apply')}</Button>
            <Button type="button" variant="ghost" onClick={() => setState({ status: 'idle' })}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
