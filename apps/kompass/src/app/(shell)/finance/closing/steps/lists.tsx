'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

/** Schritt 3: vier Zahlen mit Links; Bestätigen nur, wenn nur noch Belege ohne Buchung oder fremdes Geld bleiben. */
export function ListsStep({ step, status, canConfirm, onConfirm }: ClosingStepBody<'lists'>) {
  const t = useTranslations('finance.closing.lists');
  const f = step.facts;
  const year = encodeURIComponent(status.fiscalYearId);
  const rows = [
    { key: 'undocumented', count: f.undocumentedUnjustified, href: `/finance/entries?year=${year}&novoucher=1` },
    { key: 'drafts', count: f.drafts, href: `/finance/entries?year=${year}&state=draft` },
    { key: 'vouchers', count: f.vouchersWithoutEntry, href: '/finance/work/vouchers' },
    { key: 'foreign', count: f.foreignMoneyOpen, href: '/finance/work/foreign' },
  ] as const;
  const hardLeft = f.undocumentedUnjustified > 0 || f.drafts > 0;
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-lists">
      <p className="text-meta text-ink-2">{t('intro')}</p>
      <ul className="flex flex-col gap-1 text-body">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="text-link underline-offset-2 hover:underline">
                {t(r.key, { count: r.count })}
              </Link>
            </li>
          ))}
      </ul>
      {hardLeft ? <p className="text-meta text-muted-ink">{t('hardFirst')}</p> : null}
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm} />
    </div>
  );
}
