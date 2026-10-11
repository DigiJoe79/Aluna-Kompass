'use client';

import { useTranslations } from 'next-intl';
import type { BalancesView, IncomeStatement } from '@kompass/module-finance';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { Section } from '@/components/section';

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

  const collapse = (
    <Button type="button" variant="link" className="h-auto p-0" onClick={() => setPref('closed')}>
      {t('collapse')}
    </Button>
  );
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('expand')}
        onClick={() => setPref('open')}
        className={cn('shrink-0 self-start', explicit ? (open ? 'hidden' : 'inline-flex') : 'hidden max-[1359px]:inline-flex')}
      >
        {t('expand')}
      </Button>
      <aside
        data-testid="finance-side-panel"
        className={cn(
          'w-[280px] shrink-0 rounded-md border border-line bg-surface p-4',
          explicit ? (open ? 'block' : 'hidden') : 'hidden min-[1360px]:block',
        )}
      >
        <Section title={t('title')} actions={collapse}>
        <div className="space-y-4">

        <div className="space-y-2">
          {balances.accounts.map((account) => (
            <div key={account.accountId} className="space-y-0.5">
              <p className="text-meta font-semibold">{account.name}</p>
              <p className="text-right font-mono text-body tabular-nums">{formatEuro(account.balanceCents)}</p>
              <p className="text-right text-hint text-muted-ink">{t('withReviewed', { amount: formatEuro(account.withReviewedCents) })}</p>
            </div>
          ))}
        </div>

        {incomeStatement ? (
          <div className="space-y-2 border-t border-line pt-3">
            {incomeStatement.spheres.map((sphere) => (
              <div key={sphere.sphere} className="flex items-center justify-between text-meta">
                <span className="text-ink-2">{t(`sphere.${sphere.sphere}`)}</span>
                <span className="font-mono tabular-nums">{formatEuro(sphere.resultCents)}</span>
              </div>
            ))}
            {incomeStatement.preliminary ? <p className="text-hint text-muted-ink">{t('preliminary')}</p> : null}
          </div>
        ) : null}
        </div>
        </Section>
      </aside>
    </>
  );
}
