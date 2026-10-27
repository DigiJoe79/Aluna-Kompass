'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import type { ClosingStepBody } from '../step-body';
import { ConfirmRow } from './confirm-row';

const TO_CORRECT = '/finance/donations?tab=toCorrect';

/** Schritt 7 (Board 10a): ohne Warnfarbe — Zahl als Satz, Hilfesatz, „zu korrigieren“ als Nummern bis drei, sonst als Zahl. */
export function ConfirmationsStep({ step, status, canConfirm, onConfirm }: ClosingStepBody<'confirmations'>) {
  const t = useTranslations('finance.closing.confirmations');
  const f = step.facts;
  const numbers = f.toCorrectNumbers.filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-confirmations">
      <p className="text-body text-ink-2">{t('summary', { uncertified: f.uncertified, toCorrect: f.toCorrect })}</p>
      <p className="text-meta text-muted-ink">{t('help')}</p>
      {f.toCorrect > 0 ? (
        f.toCorrect <= 3 && numbers.length === f.toCorrect ? (
          <p className="flex flex-wrap gap-x-2 text-body" data-testid="closing-to-correct">
            <span className="text-ink-2">{t('toCorrectNumbers', { count: f.toCorrect })}</span>
            {numbers.map((n) => (
              <Link key={n} href={TO_CORRECT} className="text-link underline-offset-2 hover:underline">
                {n}
              </Link>
            ))}
          </p>
        ) : (
          <p className="text-body" data-testid="closing-to-correct">
            <Link href={TO_CORRECT} className="text-link underline-offset-2 hover:underline">
              {t('toCorrectLink', { count: f.toCorrect })}
            </Link>
          </p>
        )
      ) : null}
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm}>
        {status.me.canRunConfirmations ? (
          <Link href="/finance/donations/run" className={buttonVariants({ variant: 'outline' })}>
            {t('run')}
          </Link>
        ) : null}
      </ConfirmRow>
    </div>
  );
}
