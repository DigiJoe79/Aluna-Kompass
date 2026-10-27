'use client';

import type { DonationReconciliation } from '@kompass/module-finance';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';

/**
 * Abstimmung „Zuwendungen ↔ Bestätigungen“ (C4, F6b Task 8, README 3j): drei
 * Summen, dann die Differenz nach Gründen — je Grund Anzahl, Betrag und ein
 * Sprung dorthin, wo man sie auflöst. Übersteigen Bestätigungen die
 * Zuwendungen (eine Rückgabe nach der Bestätigung, Prüfstein 6), steht das
 * als Satz unter der Tabelle — kein Teil der Summe, Wortlaut wie im Bericht.
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
              <span data-testid="reconciliation-donations" className="text-body tabular-nums text-ink">{formatEuro(data.donationsCents)}</span>
            </span>
            <span className="flex flex-col">
              <Overline as="span">{t('confirmed')}</Overline>
              <span data-testid="reconciliation-confirmed" className="text-body tabular-nums text-ink">{formatEuro(data.confirmedCents)}</span>
            </span>
            <span className="flex flex-col">
              <Overline as="span">{t('difference')}</Overline>
              <span data-testid="reconciliation-difference" className="text-body tabular-nums text-ink">{formatEuro(data.differenceCents)}</span>
            </span>
          </div>

          {balanced ? (
            <p data-testid="reconciliation-balanced" className="text-meta text-ink-2">{t('balanced')}</p>
          ) : (
            <div className="space-y-1.5">
              {data.reasons.length > 0 ? (
                <>
                  <Overline>{t('reasonsTitle')}</Overline>
                  {/* 09 B22: Die Gründe stehen in einer Tabelle mit Spaltenkopf. */}
                  <div className="overflow-hidden rounded-md border border-line">
                    <Table className="text-meta">
                      <TableHeader>
                        <TableRow>
                          <TableHead col="title">{t('columns.reason')}</TableHead>
                          <TableHead col="meta" className="text-right">{t('columns.count')}</TableHead>
                          <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.reasons.map((reason) => (
                          <TableRow key={reason.key} data-testid="reconciliation-reason">
                            <TableCell col="title">
                              <RowLink href={reason.href}>{t(`reason.${reason.key}`)}</RowLink>
                            </TableCell>
                            <TableCell col="meta" className="text-right tabular-nums text-ink-2">{reason.count}</TableCell>
                            <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(reason.cents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
              {/* Kein Teil der Summe der Gründe (6f32f6fe): ein Satz unter der Tabelle wie im PDF-Bericht (E15, Befund 40). */}
              {data.toCorrect.count > 0 ? (
                <p data-testid="reconciliation-to-correct" className="text-meta text-ink-2">
                  {t.rich('toCorrect', {
                    count: data.toCorrect.count,
                    amount: formatEuro(data.toCorrect.cents),
                    without: data.toCorrect.withoutAmountCount,
                    link: (chunks) => <Link href={data.toCorrect.href} className="text-link underline">{chunks}</Link>,
                  })}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </Section>
    </section>
  );
}
