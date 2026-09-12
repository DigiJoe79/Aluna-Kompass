'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Telefon und Tablet als feste Breite; Desktop ist die volle Breite der Seite. */
export const PREVIEW_WIDTHS = { desktop: null, tablet: 820, mobile: 390 } as const;
type Width = keyof typeof PREVIEW_WIDTHS;

export function PreviewFrameClient() {
  const t = useTranslations('site.previewFrame');
  const [width, setWidth] = useState<Width>('desktop');
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label={t('widths.label')}>
        {(Object.keys(PREVIEW_WIDTHS) as Width[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={width === key}
            onClick={() => setWidth(key)}
            className={cn('rounded-md border border-line px-3 py-1.5 text-[13px] font-medium', width === key ? 'bg-primary text-primary-foreground' : 'bg-surface text-ink-2')}
          >
            {t(`widths.${key}`)}{PREVIEW_WIDTHS[key] ? ` · ${PREVIEW_WIDTHS[key]}px` : ''}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <iframe
          src="/site/preview/"
          title={t('frameTitle')}
          style={{ width: PREVIEW_WIDTHS[width] ? `${PREVIEW_WIDTHS[width]}px` : '100%', maxWidth: '100%' }}
          className="block h-[80vh] border-0"
        />
      </div>
    </div>
  );
}
