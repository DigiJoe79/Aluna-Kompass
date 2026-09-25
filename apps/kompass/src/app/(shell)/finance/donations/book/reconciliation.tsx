'use client';

import type { DonationReconciliation } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { formatEuro } from '@/lib/finance/amount';

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
    <section data-testid="donation-reconciliation" className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="font-heading text-[17px] text-ink">{t('title')}</h3>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <span className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('donations')}</span>
          <span data-testid="reconciliation-donations" className="font-mono text-[14px] tabular-nums text-ink">{formatEuro(data.donationsCents)}</span>
        </span>
        <span className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('confirmed')}</span>
          <span data-testid="reconciliation-confirmed" className="font-mono text-[14px] tabular-nums text-ink">{formatEuro(data.confirmedCents)}</span>
        </span>
        <span className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('difference')}</span>
          <span data-testid="reconciliation-difference" className="font-mono text-[14px] tabular-nums text-ink">{formatEuro(data.differenceCents)}</span>
        </span>
      </div>

      {balanced ? (
        <p data-testid="reconciliation-balanced" className="text-[13px] text-ink-2">{t('balanced')}</p>
      ) : (
        <div className="space-y-1.5">
          {data.reasons.length > 0 ? <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('reasonsTitle')}</p> : null}
          <ul className="divide-y divide-line-2 rounded-md border border-line text-[13px]">
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
    </section>
  );
}
