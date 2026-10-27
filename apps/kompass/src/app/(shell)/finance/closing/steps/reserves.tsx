'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { buttonVariants } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

/** Schritt 6 (Board 3a): Rücklagen als Liste mit Ende und Veränderung, „Beschluss fehlt“ als Text. */
export function ReservesStep({ step, status, canConfirm, onConfirm }: ClosingStepBody<'reserves'>) {
  const t = useTranslations('finance.closing.reserves');
  const fmt = useDateFormat();
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-reserves">
      <p className="text-meta text-ink-2">{t('intro', { date: fmt.date(status.endsOn) })}</p>
      {/* Raster wie Board 3a und Schritt 2: Name, Betrag rechtsbündig, Veränderung gedämpft. */}
      <div className="grid max-w-prose grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 text-body text-ink-2">
        {step.facts.reserves.map((r) => {
          const change = r.closingCents - r.openingCents;
          return (
            <div key={r.reserveId} className="contents" data-testid="closing-reserve">
              <span className="min-w-0">{r.name}</span>
              <span className="text-right tabular-nums">{formatEuro(r.closingCents)}</span>
              <span className="text-muted-ink tabular-nums">{change === 0 ? t('unchanged') : formatEuro(change, { sign: 'always' })}</span>
              {!r.hasResolution ? <span className="col-span-3 text-meta text-muted-ink">{t('noResolution')}</span> : null}
            </div>
          );
        })}
      </div>
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm}>
        <Link href="/finance/reserves" className={buttonVariants({ variant: 'outline' })}>
          {t('link')}
        </Link>
      </ConfirmRow>
    </div>
  );
}
