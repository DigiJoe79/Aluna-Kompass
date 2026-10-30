'use client';

import type { AnnualAccounts } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';
import { formatEuro } from '@/lib/finance/amount';
import { ValueList } from './value-list';

/**
 * „Auf einen Blick“ (Designer 1f, Abnahme 13): die vier Werte aus F1 derselben Rechnung — Einnahmen, Ausgaben, Ergebnis,
 * Vermögen am Jahresende —, nur am Telefon. Am Rechner zeigt die Vorschau F1 lesbar.
 */
export function AtAGlance({ glance, endsOn }: { glance: AnnualAccounts['glance']; endsOn: string }) {
  const t = useTranslations('finance.reports.annualAccounts.glance');
  const fmt = useDateFormat();
  return (
    <div className="sm:hidden" data-testid="annual-accounts-glance">
      <Section title={t('title')}>
        <ValueList
          rows={[
            { key: 'income', label: t('income'), value: formatEuro(glance.incomeCents) },
            { key: 'expense', label: t('expense'), value: formatEuro(glance.expenseCents) },
            { key: 'result', label: t('result'), value: formatEuro(glance.resultCents) },
            { key: 'assets', label: t('assets', { date: fmt.date(endsOn) }), value: formatEuro(glance.netAssetsCents) },
          ]}
        />
      </Section>
    </div>
  );
}
