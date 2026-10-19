'use client';

import type { DunningPreview } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { SectionHeading } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/finance/amount';
import { startDunningRunAction } from '../../actions';
import { RunSteps } from '../../runs/run-steps';

/**
 * Auswahl und Vorschau des Mahnlaufs (Handoff Mitglieder 2.5, 6a; N4): Stichtag, dann Gruppen — „Zahlung könnte passen“
 * (`warning`, hält nur dieses Mitglied an, Ausweg „Zuordnen“ in die Arbeitsliste), je Stufe die Briefe, „Übersprungen“
 * mit Grund. Ein Brief je Mitglied.
 */
export function DunningRunFlow({ asOf, today, preview, paymentTermDays, levels, canStart }: { asOf: string | null; today: string; preview: DunningPreview | null; paymentTermDays: number; levels: { key: string; last: boolean }[]; canStart: boolean }) {
  const t = useTranslations('members.dunningRun');
  const { date } = useDateFormat();
  const router = useRouter();
  const [selAsOf, setSelAsOf] = useState(asOf ?? today);
  const [starting, setStarting] = useState(false);
  const feedback = useActionFeedback();

  const start = async () => {
    if (!preview) return;
    setStarting(true);
    const result = await feedback.run(() => startDunningRunAction({ asOf: preview.asOf }), { retry: () => void start() });
    if (result.status !== 'success') {
      setStarting(false);
      return;
    }
    router.push(`/members/fees/dunning?run=${(result.data as { id: string }).id}`);
  };

  if (!preview) {
    return (
      <div className="space-y-4">
        <RunSteps active="selection" />
        <form
          aria-label={t('asOf')}
          className="flex flex-wrap items-end gap-4 rounded-md border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/members/fees/dunning?asOf=${selAsOf}`);
          }}
        >
          <FormField id="dunning-as-of" label={t('asOf')}>
            <Input id="dunning-as-of" type="date" value={selAsOf} max={today} onChange={(e) => setSelAsOf(e.target.value)} />
          </FormField>
          <Button type="submit">{t('show')}</Button>
        </form>
      </div>
    );
  }

  const byLevel = [...new Set(preview.ready.map((c) => c.levelKey))].map((key) => ({ key, items: preview.ready.filter((c) => c.levelKey === key) }));
  const levelTone = (key: string) => statusTone('dunning', levels.find((l) => l.key === key)?.last ? 'lastLevel' : 'level');
  const nothing = preview.ready.length + preview.paymentMayMatch.length + preview.skipped.length === 0;

  return (
    <div className="space-y-4">
      <RunSteps active="preview" />
      <div data-testid="run-selection-summary" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-ink">
          <span>{t('summary', { date: date(preview.asOf) })}</span>
          <span className="text-ink-2">{t('summaryTerm', { days: paymentTermDays })}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => router.push('/members/fees/dunning')} disabled={starting}>{t('change')}</Button>
      </div>

      {nothing ? <EmptyState title={t('empty')} text={t('description')} /> : null}

      {preview.paymentMayMatch.length > 0 ? (
        <section data-testid="run-group-paymentMayMatch" aria-labelledby="dunning-group-match" className="rounded-md border border-line bg-surface">
          <div className="px-4 pt-3 pb-2">
            <SectionHeading id="dunning-group-match">
              <StatusBadge tone="warning" dot>{t('groups.paymentMayMatch')}</StatusBadge> · {t('groupMembers', { count: preview.paymentMayMatch.length })}
            </SectionHeading>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
            {preview.paymentMayMatch.map((c) => (
              <li key={`${c.membershipId}:${c.levelKey}`} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-ink-2">{t('matchHint')}</span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <Link href="/finance/work" className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('assign')}</Link>
                  <span className="tabular-nums text-ink">{formatEuro(c.sumCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {byLevel.map((group) => (
        <section key={group.key} data-testid={`run-group-${group.key}`} aria-labelledby={`dunning-group-${group.key}`} className="rounded-md border border-line bg-surface">
          <div className="px-4 pt-3 pb-2">
            <SectionHeading id={`dunning-group-${group.key}`}>
              <StatusBadge tone={levelTone(group.key)} dot>{group.items[0]!.levelName}</StatusBadge> · {t('groupLetters', { count: group.items.length })}
            </SectionHeading>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
            {group.items.map((c) => (
              <li key={`${c.membershipId}:${c.levelKey}`} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-ink-2 tabular-nums">{c.memberNumber}</span>
                  {c.returnedOn ? <span className="text-muted-ink">{t('returned', { date: date(c.returnedOn) })}</span> : null}
                </span>
                <span className="tabular-nums text-ink">{formatEuro(c.sumCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {preview.skipped.length > 0 ? (
        <section data-testid="run-group-skipped" aria-labelledby="dunning-group-skipped" className="rounded-md border border-line bg-surface">
          <div className="px-4 pt-3 pb-2">
            <SectionHeading id="dunning-group-skipped">
              <StatusBadge tone="neutral">{t('groups.skipped')}</StatusBadge> · {t('groupMembers', { count: preview.skipped.length })}
            </SectionHeading>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
            {preview.skipped.map((s) => (
              <li key={s.membershipId} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{s.name}</span>
                  <span className="text-ink-2">{t(`skip.${s.reason}`)}</span>
                </span>
                <Link href={`/members/${s.membershipId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('openMember')}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canStart ? (
        // Die Laufleiste als eigene Karte unter den Gruppen (5a/6a); sie klebt wie die Speicherleiste.
        <FormCard>
        <FormActionBar
          mode="run"
          testId="run-footer"
          note={<span className="max-w-prose text-hint text-muted-ink">{t('humanOnly')}</span>}
          extraActions={preview.paymentMayMatch.length > 0 ? <span className="self-center text-meta text-ink">{t('footerHeld', { count: preview.paymentMayMatch.length })}</span> : undefined}
          saveLabel={preview.ready.length > 0 ? t('footer', { count: preview.ready.length }) : t('footerNone')}
          // R1: Der Lauf geht nur bis heute; die Vorschau darf vorausschauen.
          saveDisabled={preview.ready.length === 0 || preview.asOf > today || starting}
          pending={starting}
          onSave={() => void start()}
          state={feedback.state}
        />
        </FormCard>
      ) : (
        <p data-testid="run-footer" className="text-meta text-ink-2">{t('noPermission')}</p>
      )}
    </div>
  );
}
