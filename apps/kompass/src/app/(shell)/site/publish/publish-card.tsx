'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { runPublishAction } from './actions';
import type { PublishDiff } from './diff-card';

export function PublishCard({
  env,
  publicUrl,
  hasDeploy,
  diff,
  hasViolations,
  onPublished,
}: {
  env: string;
  publicUrl: string | null;
  hasDeploy: boolean;
  diff: PublishDiff | null;
  hasViolations: boolean;
  onPublished?: () => void;
}) {
  const t = useTranslations('site.publish.publishCard');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, start] = useTransition();

  const isDev = env === 'development';
  const buttonLabel = env === 'test' ? t('staging') : t('live');

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px]">Publizieren</h3>
          <p className="text-[13px] text-muted-ink">
            {isDev
              ? t('notHere')
              : !hasDeploy
              ? t('noTarget')
              : hasViolations
              ? t('blocked')
              : `Ziel: ${publicUrl ?? '—'}`}
          </p>
        </div>

        {!isDev && hasDeploy && !hasViolations && (
          <Button onClick={() => setDialogOpen(true)}>{buttonLabel}</Button>
        )}
      </div>

      {dialogOpen && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-lg">
            <h3 id="dialog-title" className="font-heading text-[18px]">
              {t('confirmTitle')}
            </h3>
            <p className="mt-2 text-[13px] text-ink-2">
              {t('confirmText', {
                url: publicUrl ?? '—',
                changed: diff?.changed.length ?? 0,
                added: diff?.added.length ?? 0,
                removed: diff?.removed.length ?? 0,
              })}
            </p>

            {pending ? (
              <div className="mt-6 flex items-center gap-2 text-[13px] font-medium text-ink-2" aria-live="polite">
                <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {t('steps.build')} … {t('steps.transfer')} … {t('steps.record')} …
              </div>
            ) : (
              <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() =>
                    start(async () => {
                      const s = await runPublishAction(true);
                      if (s.status === 'error') {
                        toast.error(s.message);
                      } else if (s.status === 'success') {
                        toast.success(s.message ?? t('published'));
                        setDialogOpen(false);
                        onPublished?.();
                      }
                    })
                  }
                >
                  {t('confirm')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
