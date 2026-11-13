'use client';

import type { TaxFigureCause } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice } from '@/components/notice';
import type { ReviewNoticeKind } from './review-state';

/** B9 (Spec 0.5.2 § 6): der Hinweis über den Werten nach der Abgabe; welcher gilt, sagt `reviewNoticeKind` (`review-state.ts`). */

export function useCauseText(): (causes: readonly TaxFigureCause[]) => string {
  const t = useTranslations('finance.tax.review');
  return (causes) => causes.map((c) => (c.kind === 'line' ? (c.year ? t('cause.lineYear', { line: c.line, year: c.year }) : t('cause.line', { line: c.line })) : t(`cause.${c.report}`, { year: c.year ?? '' }).trim())).join(', ');
}

export function ReviewNotice({ kind, causes, periodId }: { kind: ReviewNoticeKind; causes: readonly TaxFigureCause[]; periodId: string }) {
  const t = useTranslations('finance.tax.review');
  const tFiling = useTranslations('finance.tax.filing');
  const causeText = useCauseText();
  const differences = (
    <Link href={`/finance/reports/taxReturnGem?period=${encodeURIComponent(periodId)}`} className="text-link underline-offset-2 hover:underline">
      {tFiling('differences')}
    </Link>
  );
  if (kind === 'review') {
    return (
      <Notice level="warn" title={t('due', { causes: causeText(causes) })} testId="tax-review">
        <div className="space-y-1">
          <p>{t('dueText')}</p>
          <p>{t('elster')}</p>
          <p>{t('board')}</p>
        </div>
      </Notice>
    );
  }
  return (
    <Notice level="hint" testId={`tax-review-${kind}`}>
      {t(kind)} {differences}
    </Notice>
  );
}
