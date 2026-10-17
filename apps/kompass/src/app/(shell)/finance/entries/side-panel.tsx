'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BalancesView, IncomeStatement } from '@kompass/module-finance';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { Section } from '@/components/section';
import { useHelpAside } from '@/components/shell/help-panel';

export interface SidePanelProps {
  balances: BalancesView;
  incomeStatement: (IncomeStatement & { preliminary: boolean }) | null;
}

/**
 * Randspalte „Bestände und vorläufige Summen“ (HANDOFF § 5.2). Vorgabe aus dem
 * Breakpoint (reines CSS, damit nichts flackert); gespeichert wird nur die
 * ausdrückliche Wahl. Ein schmaler Griff bleibt immer erreichbar, auch wenn
 * die Spalte gerade unsichtbar ist — sonst käme man unter 1680 px nie mehr hinein.
 * 07-1 B33 · 13 #10: Erst ab 1680 px steht das Panel neben dem Journal (elf Spalten brauchen die Breite); darunter
 * steht es, wenn man es öffnet, über der Tabelle (`page.tsx`). Ohne Layout-Test (Einzelstelle).
 */
export function SidePanel({ balances, incomeStatement }: SidePanelProps) {
  const t = useTranslations('finance.journal.sidePanel');
  const [pref, setPref] = usePreference('financeSidePanel');
  // Hilfe und Seitenpanel teilen sich eine Nebenspalte (Entwurf E4): Steht die Hilfe daneben, ist das Panel eingeklappt.
  const helpAside = useHelpAside();
  const explicit = helpAside || pref !== 'auto';
  const open = !helpAside && pref === 'open';

  const collapse = (
    <Button type="button" variant="link" className="h-auto p-0" onClick={() => setPref('closed')}>
      {t('collapse')}
    </Button>
  );
  // „Ausklappen“ steht am rechten Rand der Werkzeugleiste des Journals (Runde 3, 086), nicht über dem Seitentitel.
  const [toggleSlot, setToggleSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setToggleSlot(document.getElementById('finance-side-panel-toggle')), []);
  const toggle = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={t('expand')}
      onClick={() => setPref('open')}
      // Steht die Hilfe daneben, fehlt auch der Knopf: Er nähme der Liste eine eigene Spalte (Abweichung von E4, dort
      // „Knopf im Seitenkopf“; lauf-2-offen Teil H). Wer die Hilfe schließt, hat ihn wieder.
      className={cn('shrink-0 self-start', helpAside ? 'hidden' : explicit ? (open ? 'hidden' : 'inline-flex') : 'hidden max-[1679px]:inline-flex')}
    >
      {t('expand')}
    </Button>
  );
  return (
    <>
      {toggleSlot ? createPortal(toggle, toggleSlot) : null}
      <aside
        data-testid="finance-side-panel"
        data-list-aside={explicit ? (open ? 'open' : 'closed') : 'auto'}
        className={cn(
          'shrink-0 rounded-md border border-line bg-surface p-4 min-[1680px]:w-[280px]',
          explicit ? (open ? 'block' : 'hidden') : 'hidden min-[1680px]:block',
        )}
      >
        <Section title={t('title')} actions={collapse}>
        <div className="space-y-4">

        <div className="space-y-2">
          {balances.accounts.map((account) => (
            // Name links, Betrag rechts in einer Zeile; „einschließlich geprüfter Entwürfe“ als Unterzeile unter dem Namen,
            // ihr Betrag rechts darunter (Runde 4, A3, 212).
            <div key={account.accountId} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <p className="text-meta font-semibold">{account.name}</p>
              <p className="text-right text-body tabular-nums">{formatEuro(account.balanceCents)}</p>
              {/* 07-1 B35: nur, wenn geprüfte Entwürfe den Bestand ändern. */}
              {account.withReviewedCents !== account.balanceCents ? (
                <>
                  <p className="text-hint text-muted-ink">{t('withReviewed')}</p>
                  <p className="text-right text-hint tabular-nums text-muted-ink">{formatEuro(account.withReviewedCents)}</p>
                </>
              ) : null}
            </div>
          ))}
        </div>

        {incomeStatement ? (
          <div className="space-y-2 border-t border-line pt-3">
            {incomeStatement.spheres.map((sphere) => (
              <div key={sphere.sphere} className="flex items-center justify-between text-meta">
                <span className="text-ink-2">{t(`sphere.${sphere.sphere}`)}</span>
                <span className="tabular-nums">{formatEuro(sphere.resultCents)}</span>
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
