'use client';

import type { AnnualAccounts } from '@kompass/module-finance';
import { formatPercent } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice } from '@/components/notice';
import { panelHref } from '@/components/panel-nav';

const linkClass = 'text-link underline-offset-2 hover:underline';

/**
 * Hinweise der Bildschirmansicht der Jahresrechnung (Designer, Abnahme 9): nur, was zu prüfen ist — je Posten über
 * 25 % und je Verlust im wirtschaftlichen Geschäftsbetrieb oder in der Vermögensverwaltung ein `Notice warn`, sonst
 * nichts. Kostenquote und Überleitung stehen in „Zur Kontrolle“ (`ControlValues`). `labels` übersetzt die Schlüssel der
 * Posten (Einnahmezeilen, `fundraising`, `administration`, `project:<id>`).
 */
export function AnnualAccountsNotices({ screen, labels, fiscalYearId }: { screen: AnnualAccounts['screen']; labels: Record<string, string>; fiscalYearId: string }) {
  const t = useTranslations('finance.reports.annualAccounts');
  if (screen.over25.length === 0 && screen.operationsLoss.length === 0) return null;
  return (
    <>
      {screen.over25.map((item) => (
        <Notice
          key={`${item.section}-${item.key}`}
          level="warn"
          action={
            <Link href={panelHref('/admin/finance', 'categories')} className={linkClass}>
              {t('toCategories')}
            </Link>
          }
        >
          {t('over25', { item: labels[item.key] ?? t('labels.project'), percent: formatPercent(item.sharePermille), section: item.section })}
        </Notice>
      ))}
      {screen.operationsLoss.map((sphere) => (
        <Notice
          key={sphere}
          level="warn"
          action={
            <Link href={`/finance/reports/incomeStatement?year=${encodeURIComponent(fiscalYearId)}`} className={linkClass}>
              {t('toIncomeStatement')}
            </Link>
          }
        >
          {t('operationsLoss', { sphere })}
        </Notice>
      ))}
    </>
  );
}
