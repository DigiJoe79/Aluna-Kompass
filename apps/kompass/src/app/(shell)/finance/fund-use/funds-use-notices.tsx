'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { formatEuro } from '@/lib/finance/amount';
import type { FundsUseNotice } from './funds-use-view';

const linkClass = 'text-link underline-offset-2 hover:underline';

/**
 * Warnungen der Mittelverwendung über den Seiten (Board 3a B): je Eintrag aus `fundsUseNotices` ein `Notice warn` — die
 * versäumte Frist mit dem Weg zu „Fristen und Schwellen“, der Verlust mit dem Weg zur EÜR. Ohne Eintrag nichts.
 */
export function FundsUseNotices({ notices, year }: { notices: FundsUseNotice[]; year: { id: string; designation: string } }) {
  const t = useTranslations('finance.fundUse.notices');
  const fmt = useDateFormat();
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n, i) =>
        n.kind === 'deadlineMissed' ? (
          <Notice
            key={`deadline-${n.origin}-${i}`}
            level="warn"
            action={
              <Link href="/finance/deadlines" className={linkClass}>
                {t('toDeadlines')}
              </Link>
            }
          >
            {t('deadlineMissed', { amount: formatEuro(n.restCents), origin: n.origin, date: fmt.date(n.dueBy) })}
          </Notice>
        ) : n.kind === 'loss' ? (
          <Notice
            key={`loss-${n.sphere}`}
            level="warn"
            action={
              <Link href={`/finance/reports/incomeStatement?year=${encodeURIComponent(year.id)}`} className={linkClass}>
                {t('toIncomeStatement')}
              </Link>
            }
          >
            {t('loss', { sphere: n.sphere, year: year.designation, amount: formatEuro(n.cents) })}
          </Notice>
        ) : (
          <Notice key="endowment" level="warn">
            {t('endowmentWithOverhang')}
          </Notice>
        ),
      )}
    </>
  );
}
