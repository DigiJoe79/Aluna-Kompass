'use client';

import { CheckCircle2, Clock, MinusCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';

/**
 * Der Ausgleichsanzeiger (HANDOFF § 2.3, Baustein 2): klebt am unteren Rand
 * der Konto-Karte. Drei Zustände, nie in Fehlerfarbe — ein Arbeitsstand ist
 * kein Fehler, erst „Festschreiben“ macht daraus eine Ablehnung.
 */
export function BalanceIndicator({ open, accountCents, allocatedCents }: { open: number; accountCents?: number; allocatedCents?: number }) {
  const t = useTranslations('finance.balanceIndicator');
  const detail = accountCents !== undefined && allocatedCents !== undefined ? t('detail', { account: formatEuro(accountCents), allocated: formatEuro(allocatedCents) }) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2 border-t px-3 py-2 text-[13px]', open === 0 ? 'border-line bg-success-bg' : 'border-line bg-warning-bg')}
    >
      {open === 0 ? (
        <>
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          <span>
            <span className="font-semibold text-success">{t('balanced')}</span>
            {detail ? <span className="text-ink-2"> · {detail}</span> : null}
          </span>
        </>
      ) : open > 0 ? (
        <>
          <Clock className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="font-semibold text-warning">{t('remaining', { amount: formatEuro(open) })}</span>
        </>
      ) : (
        <>
          <MinusCircle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="font-semibold text-warning">{t('excess', { amount: formatEuro(-open) })}</span>
        </>
      )}
    </div>
  );
}
