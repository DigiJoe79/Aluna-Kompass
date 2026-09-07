'use client';

import { useTranslations } from 'next-intl';
import { Disclosure } from '@/components/ui/disclosure';

export interface PublishDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

function FileList({ files }: { files: string[] }) {
  return (
    <ul className="flex flex-col gap-1 font-mono text-[12px]">
      {files.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
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
        <div className="flex flex-col gap-3">
          {diff.added.length > 0 && (
            <Disclosure label={t('added')} count={diff.added.length} tone="success">
              <FileList files={diff.added} />
            </Disclosure>
          )}
          {diff.changed.length > 0 && (
            <Disclosure label={t('changed')} count={diff.changed.length} tone="warning">
              <FileList files={diff.changed} />
            </Disclosure>
          )}
          {diff.removed.length > 0 && (
            <Disclosure label={t('removed')} count={diff.removed.length} tone="error">
              <FileList files={diff.removed} />
            </Disclosure>
          )}
        </div>
      )}
    </section>
  );
}
