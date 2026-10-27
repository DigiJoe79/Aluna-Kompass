'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { buttonVariants } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

/** Schritt 4: Zahl und Summe je Art, Link auf die offenen Zahlungen, Bestätigen mit Begründung. */
export function OpenItemsStep({ step, status, canConfirm, onConfirm }: ClosingStepBody<'openItems'>) {
  const t = useTranslations('finance.closing.openItems');
  const fmt = useDateFormat();
  const f = step.facts;
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-openItems">
      <p className="text-meta text-ink-2">{t('intro', { date: fmt.date(status.endsOn) })}</p>
      <ul className="flex flex-col gap-1 text-body text-ink-2">
        {f.receivables.count > 0 ? <li>{t('receivables', { count: f.receivables.count, amount: formatEuro(f.receivables.cents) })}</li> : null}
        {f.payables.count > 0 ? <li>{t('payables', { count: f.payables.count, amount: formatEuro(f.payables.cents) })}</li> : null}
      </ul>
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm}>
        <Link href="/finance/open-items" className={buttonVariants({ variant: 'outline' })}>
          {t('link')}
        </Link>
      </ConfirmRow>
    </div>
  );
}
