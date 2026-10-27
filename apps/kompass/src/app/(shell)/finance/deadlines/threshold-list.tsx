'use client';

import type { ThresholdView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FilterBar, frameFilter } from '@/components/filter-bar';
import { LimitProgress, type LimitState } from '@/components/finance/limit-progress';
import { Section } from '@/components/section';
import { formatEuro } from '@/lib/finance/amount';

const BAR: Partial<Record<ThresholdView['state'], LimitState>> = { quiet: 'calm', approaching: 'near', exceeded: 'exceeded' };

/**
 * Abschnitt „Schwellen <Jahr>“ (Board 6a) mit dem Jahr als Rahmen: je Schwelle `LimitProgress` („<Wert> von <Grenze>“,
 * Satz darunter, „nähert sich“ nur am ockerfarbenen Balken); ohne Pflicht, nicht anwendbar, nicht abgebildet und
 * Hinweise als Satz ohne Balken. Die Person einer Pauschale nennt der Dienst nur mit `finance.read`.
 */
export function ThresholdList({ thresholds, years, yearId, designation }: { thresholds: readonly ThresholdView[]; years: readonly { id: string; designation: string }[]; yearId: string; designation: string }) {
  const t = useTranslations('finance.deadlines.thresholds');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/deadlines?year=${encodeURIComponent(value)}`));
  const amount = (cents: number | null) => formatEuro(cents ?? 0);

  return (
    <Section title={t('title', { year: designation })} intro={t('intro')}>
      <div className="flex flex-col gap-4">
        <FilterBar
          filters={[frameFilter({ key: 'year', label: t('yearChoice'), value: yearId, options: years.map((y) => ({ value: y.id, label: y.designation })), onChange: go })]}
          onApply={(values) => (values.year ? go(values.year) : undefined)}
          count={{ shown: thresholds.length, total: thresholds.length, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
          onReset={() => undefined}
          testId="thresholds-year"
        />
        <ul className="flex flex-col gap-4" data-testid="thresholds">
          {thresholds.map((th) => {
            const bar = BAR[th.state];
            const notes = th.notes.map((n) => (t.has(`notes.${n}`) ? t(`notes.${n}`) : null)).filter(Boolean).join(' ');
            const sentence = [th.person ? t('person', { name: th.person.name }) : null, t.has(`texts.${th.key}`) ? t(`texts.${th.key}`) : null, notes || null].filter(Boolean).join(' ');
            return (
              <li key={th.key} data-testid="threshold" data-key={th.key} data-state={th.state}>
                {bar && th.limitCents !== null ? (
                  <LimitProgress
                    coveredCents={th.valueCents ?? 0}
                    totalCents={th.limitCents}
                    label={t(`keys.${th.key}`)}
                    state={bar}
                    stateLabel={th.state === 'quiet' ? undefined : t(`states.${th.state as 'approaching' | 'exceeded'}`)}
                    figure={t('of', { value: amount(th.valueCents), limit: amount(th.limitCents) })}
                    remainder={sentence || undefined}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="text-meta text-ink-2">{t(`keys.${th.key}`)}</p>
                    <p className="text-hint text-muted-ink">
                      {th.state === 'noObligation'
                        ? t('noObligation', { value: amount(th.valueCents), limit: amount(th.limitCents) })
                        : th.state === 'info'
                          ? t('info', { limit: amount(th.limitCents) })
                          : th.state === 'notModelled'
                            ? t('notModelled')
                            : t('notApplicable')}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
