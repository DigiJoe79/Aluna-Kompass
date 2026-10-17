import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import type { SiteJobCounts } from '@kompass/module-site';
import { Notice } from '@/components/notice';
import { withoutZeros } from '@/lib/count-parts';
import { hintCount } from './flow-state';

/**
 * Das Ergebnis der Vorschau auf einen Blick: die drei Zahlen in einer Zeile
 * und, wenn es welche gibt, die Hinweise in einem Satz. Hinweise halten den
 * Publish nicht auf; wer publiziert, übernimmt sie.
 */
export function PreviewSummary({ counts }: { counts: SiteJobCounts }) {
  const t = useTranslations('site.publish.summary');
  const bold = { b: (chunks: React.ReactNode) => <strong>{chunks}</strong> };
  const hints = hintCount({ counts });
  const parts = [
    counts.gaps > 0 ? t('gaps', { count: counts.gaps }) : null,
    counts.stale > 0 ? t('stale', { count: counts.stale }) : null,
    counts.pendingReview > 0 ? t('pendingReview', { count: counts.pendingReview }) : null,
    counts.skippedImages > 0 ? t('skippedImages', { count: counts.skippedImages }) : null,
  ].filter((p): p is string => p !== null);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-body text-ink">
        {/* Nullen fallen weg (10: 137, 140, 141). */}
        {withoutZeros([
          [counts.changed, t.rich('changed', { count: counts.changed, ...bold })],
          [counts.added, t.rich('added', { count: counts.added, ...bold })],
          [counts.removed, t.rich('removed', { count: counts.removed, ...bold })],
        ]).map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? ' · ' : null}
            {part}
          </Fragment>
        ))}
      </p>
      {hints > 0 ? (
        // 10 B21: die Hinweise als Notice mit Titel statt fettem Text in Warnfarbe.
        <Notice level="warn" title={t('hints', { count: hints })}>
          {t('hintsText', { list: parts.join(', ') })}
        </Notice>
      ) : null}
    </div>
  );
}
