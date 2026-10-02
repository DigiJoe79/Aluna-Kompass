'use client';

import { useTranslations } from 'next-intl';

/** Der Satz unter einer gekürzten Liste; bei vollständiger Liste nichts. */
export function ListTruncated({ shown, matching }: { shown: number; matching: number }) {
  const t = useTranslations('media');
  if (shown >= matching) return null;
  return (
    <p data-testid="media-list-truncated" className="mt-3 text-[13px] text-muted-ink">
      {t('listTruncated', { shown, matching })}
    </p>
  );
}
