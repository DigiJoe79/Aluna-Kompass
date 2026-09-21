'use client';

import { useTranslations } from 'next-intl';
import type { BalancesView, IncomeStatement } from '@kompass/module-finance';
import { formatEuro } from '@/lib/finance/amount';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';

export interface SidePanelProps {
  balances: BalancesView;
  incomeStatement: (IncomeStatement & { preliminary: boolean }) | null;
}

/**
 * Randspalte „Bestände und vorläufige Summen“ (HANDOFF § 5.2). Vorgabe aus dem
 * Breakpoint (reines CSS, damit nichts flackert); gespeichert wird nur die
 * ausdrückliche Wahl. Ein schmaler Griff bleibt immer erreichbar, auch wenn
 * die Spalte gerade unsichtbar ist — sonst käme man unter 1360 px nie mehr hinein.
 */
export function SidePanel({ balances, incomeStatement }: SidePanelProps) {
  const t = useTranslations('finance.journal.sidePanel');
  const [pref, setPref] = usePreference('financeSidePanel');
  const explicit = pref !== 'auto';
  const open = pref === 'open';

  return (
    <>
      <button
        type="button"
        aria-label={t('expand')}
        onClick={() => setPref('open')}
        className={cn(
          'h-9 shrink-0 self-start rounded-md border border-line-strong bg-surface px-2 text-[12px] text-ink-2',
          explicit ? (open ? 'hidden' : 'block') : 'hidden max-[1359px]:block',
        )}
      >
        {t('expand')}
      </button>
      <aside
        data-testid="finance-side-panel"
        className={cn(
          'w-[280px] shrink-0 space-y-4 rounded-md border border-line bg-surface p-4',
          explicit ? (open ? 'block' : 'hidden') : 'hidden min-[1360px]:block',
        )}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
          <button type="button" onClick={() => setPref('closed')} className="text-[12px] text-ink-2 underline underline-offset-2">
            {t('collapse')}
          </button>
        </div>

        <div className="space-y-2">
          {balances.accounts.map((account) => (
            <div key={account.accountId} className="space-y-0.5">
              <p className="text-[13px] font-semibold">{account.name}</p>
              <p className="text-right font-mono text-[14px] tabular-nums">{formatEuro(account.balanceCents)}</p>
              <p className="text-right text-[11px] text-muted-ink">{t('withReviewed', { amount: formatEuro(account.withReviewedCents) })}</p>
            </div>
          ))}
        </div>

        {incomeStatement ? (
          <div className="space-y-2 border-t border-line pt-3">
            {incomeStatement.spheres.map((sphere) => (
              <div key={sphere.sphere} className="flex items-center justify-between text-[13px]">
                <span className="text-ink-2">{t(`sphere.${sphere.sphere}`)}</span>
                <span className="font-mono tabular-nums">{formatEuro(sphere.resultCents)}</span>
              </div>
            ))}
            {incomeStatement.preliminary ? <p className="text-[11px] text-muted-ink">{t('preliminary')}</p> : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}
