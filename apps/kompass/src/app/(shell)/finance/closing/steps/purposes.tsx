'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { buttonVariants } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

/** Schritt 5: geschlossene Zwecke, Zwecke mit Bestand und Rest, Zwecke im Minus; Link auf die Zwecke. */
export function PurposesStep({ step, status, canConfirm, onConfirm }: ClosingStepBody<'purposes'>) {
  const t = useTranslations('finance.closing.purposes');
  const fmt = useDateFormat();
  const f = step.facts;
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-purposes">
      <p className="text-meta text-ink-2">{t('intro', { date: fmt.date(status.endsOn) })}</p>
      <ul className="flex flex-col gap-1 text-body text-ink-2">
        {f.closedInYear > 0 ? <li>{t('closed', { count: f.closedInYear })}</li> : null}
        {f.openWithBalance > 0 ? <li>{t('open', { count: f.openWithBalance, amount: formatEuro(f.restCents) })}</li> : null}
        {f.negative > 0 ? <li>{t('negative', { count: f.negative })}</li> : null}
      </ul>
      {f.negative > 0 ? <p className="text-meta text-muted-ink">{t('negativeBlocks')}</p> : null}
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable && f.negative === 0} onConfirm={onConfirm}>
        <Link href="/finance/purposes" className={buttonVariants({ variant: 'outline' })}>
          {t('link')}
        </Link>
      </ConfirmRow>
    </div>
  );
}
