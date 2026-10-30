'use client';

import type { AnnualAccounts } from '@kompass/module-finance';
import { formatPercent } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Empty } from '@/components/empty-value';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { formatEuro } from '@/lib/finance/amount';
import { ValueList } from './value-list';

const linkClass = 'text-link underline-offset-2 hover:underline';

/**
 * „Zur Kontrolle“ unter der Vorschau der Jahresrechnung (Designer 1a, Abnahme 9): Zahlen, die immer da sind, als
 * Wertliste statt als Hinweis — Kostenquote nach AEAO zu § 55 Nr. 19 (zu Einnahmen, wie J1 rechnet), Überleitung zur
 * Anlage Gem und, nur wenn es sie gibt, die Zahlungen an den Vorstand ohne Grundlage (die Warnung vor dem Festschreiben,
 * Planreview J1; ein `Notice warn` dafür ließe Abnahme 9 nicht zu). Nichts davon steht im PDF.
 */
export function ControlValues({ screen, remunerationWithoutBasis, year }: { screen: AnnualAccounts['screen']; remunerationWithoutBasis: number; year: { id: string; designation: string } }) {
  const t = useTranslations('finance.reports.annualAccounts.control');
  const r = screen.gemReconciliation;
  return (
    <Section title={t('title')} intro={t('intro')}>
      <ValueList
        rows={[
          { key: 'costRatio', label: t('costRatio'), value: screen.aeaoCostRatio.permille === null ? <Empty /> : formatPercent(screen.aeaoCostRatio.permille) },
          {
            key: 'reconciliation',
            label: t('reconciliation'),
            value:
              r.differenceCents === 0 ? (
                <StatusBadge tone="success">{t('matches')}</StatusBadge>
              ) : (
                <StatusBadge tone="warning">{t('difference', { amount: formatEuro(r.differenceCents) })}</StatusBadge>
              ),
            detail: (
              <>
                {t('reconciliationParts', { income: formatEuro(r.incomeCents), assetSales: formatEuro(r.assetSalesCents), taxRefunds: formatEuro(r.taxRefundsCents), line9: formatEuro(r.gemLine9Cents) })}
                {' · '}
                <Link href="/finance/tax" className={linkClass}>
                  {t('toTaxReturn', { year: year.designation })}
                </Link>
              </>
            ),
          },
          ...(remunerationWithoutBasis > 0
            ? [
                {
                  key: 'remuneration',
                  label: t('remuneration'),
                  value: (
                    <Link href="/finance/people" className={linkClass}>
                      <StatusBadge tone="warning">{t('remunerationCount', { count: remunerationWithoutBasis })}</StatusBadge>
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Section>
  );
}
