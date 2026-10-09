'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { applySeedAction, previewSeedAction, type SeedPreviewState } from '@/app/(shell)/site/actions';

export function SeedClient() {
  const t = useTranslations('site.seed');
  const [state, setState] = useState<SeedPreviewState>({ status: 'idle' });
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();
  const applyFb = useActionFeedback();

  const preview = () => start(async () => setState(await previewSeedAction()));
  const apply = () =>
    startApply(async () => {
      const result = await applyFb.run(() => applySeedAction(), { retry: apply });
      if (result.status === 'success') setState({ status: 'idle' });
    });

  const report = state.status === 'preview' ? state.report : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="text-[15px] font-semibold">{t('title')}</h3>
      <div className="flex items-center justify-between gap-4">
        <span className="max-w-prose text-[14px] text-ink-2">{t('intro')}</span>
        <Button type="button" onClick={preview} disabled={pending}>{t('preview')}</Button>
      </div>

      <RefusalNotice action state={state.status === 'error' ? { status: 'error', message: state.message, fieldErrors: {} } : { status: 'idle' }} />

      {report ? (
        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="max-w-prose text-[13px] text-ink-2">
            {t('report', { variables: report.variables, entries: report.entries, assets: report.assets })}
          </p>
          <RefusalNotice action state={applyFb.state} />
          <div className="flex gap-2">
            <Button type="button" onClick={apply} disabled={applying}>{t('apply')}</Button>
            <Button type="button" variant="ghost" onClick={() => setState({ status: 'idle' })}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
