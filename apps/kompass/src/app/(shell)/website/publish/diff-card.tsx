'use client';

import { useTranslations } from 'next-intl';

export interface PublishDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

export function DiffCard({ diff }: { diff: PublishDiff | null }) {
  const t = useTranslations('website.publish.diff');
  const hasChanges = diff && (diff.changed.length > 0 || diff.added.length > 0 || diff.removed.length > 0);

  return (
    <section aria-label={t('title')} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="font-heading text-[18px]">{t('title')}</h3>
      {!hasChanges ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          {diff.added.length > 0 && (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <h4 className="font-semibold text-success">
                {t('added')} · {diff.added.length}
              </h4>
              <ul className="mt-2 flex max-h-[200px] flex-col gap-1 overflow-y-auto font-mono text-[12px]">
                {diff.added.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {diff.changed.length > 0 && (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <h4 className="font-semibold text-warning">
                {t('changed')} · {diff.changed.length}
              </h4>
              <ul className="mt-2 flex max-h-[200px] flex-col gap-1 overflow-y-auto font-mono text-[12px]">
                {diff.changed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <h4 className="font-semibold text-error">
                {t('removed')} · {diff.removed.length}
              </h4>
              <ul className="mt-2 flex max-h-[200px] flex-col gap-1 overflow-y-auto font-mono text-[12px]">
                {diff.removed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
