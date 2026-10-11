'use client';

import type { DonationReconciliation } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { formatEuro } from '@/lib/finance/amount';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';

/**
 * Abstimmung „Zuwendungen ↔ Bestätigungen“ (C4, F6b Task 8, README 3j): drei
 * Summen, dann die Differenz nach Gründen — je Grund Anzahl, Betrag und ein
 * Sprung dorthin, wo man sie auflöst. Übersteigen Bestätigungen die
 * Zuwendungen (eine Rückgabe nach der Bestätigung, Prüfstein 6), steht das
 * als eigene Zeile „zu korrigieren“.
 */
export function Reconciliation({ data }: { data: DonationReconciliation }) {
  const t = useTranslations('finance.donations.book.reconciliation');
  const balanced = data.reasons.length === 0 && data.toCorrect.count === 0;

  return (
    <section data-testid="donation-reconciliation" className="rounded-md border border-line bg-surface p-4">
      <Section title={t('title')}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <span className="flex flex-col">
              <Overline as="span">{t('donations')}</Overline>
              <span data-testid="reconciliation-donations" className="font-mono text-body tabular-nums text-ink">{formatEuro(data.donationsCents)}</span>
            </span>
            <span className="flex flex-col">
              <Overline as="span">{t('confirmed')}</Overline>
              <span data-testid="reconciliation-confirmed" className="font-mono text-body tabular-nums text-ink">{formatEuro(data.confirmedCents)}</span>
            </span>
            <span className="flex flex-col">
              <Overline as="span">{t('difference')}</Overline>
              <span data-testid="reconciliation-difference" className="font-mono text-body tabular-nums text-ink">{formatEuro(data.differenceCents)}</span>
            </span>
          </div>

          {balanced ? (
            <p data-testid="reconciliation-balanced" className="text-meta text-ink-2">{t('balanced')}</p>
          ) : (
            <div className="space-y-1.5">
              {data.reasons.length > 0 ? <Overline>{t('reasonsTitle')}</Overline> : null}
              <ul className="divide-y divide-line-2 rounded-md border border-line text-meta">
                {data.reasons.map((reason) => (
                  <li key={reason.key} data-testid="reconciliation-reason" className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5">
                    <Link href={reason.href} className="text-link underline">{t(`reason.${reason.key}`)}</Link>
                    <span className="flex items-center gap-3 text-ink-2">
                      <span>{reason.count}</span>
                      <span className="font-mono tabular-nums text-ink">{formatEuro(reason.cents)}</span>
                    </span>
                  </li>
                ))}
                {data.toCorrect.count > 0 ? (
                  <li data-testid="reconciliation-to-correct" className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <StatusBadge tone="warning">{t('toCorrect')}</StatusBadge>
                      <Link href={data.toCorrect.href} className="text-link underline">{t('toCorrect')}</Link>
                    </span>
                    <span className="flex items-center gap-3 text-ink-2">
                      <span>{data.toCorrect.count}</span>
                      <span className="font-mono tabular-nums text-ink">{formatEuro(data.toCorrect.cents)}</span>
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </section>
  );
}
