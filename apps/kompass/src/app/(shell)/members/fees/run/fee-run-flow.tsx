'use client';

import type { FeeRunPreview } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { SectionHeading } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';
import { startFeeRunAction } from '../../actions';
import { RunSteps } from '../../runs/run-steps';

type Notices = 'directDebitOnly' | 'all';
const GROUPS = ['create', 'exists', 'exempt', 'noRule'] as const;

/**
 * Auswahl und Vorschau des Beitragslaufs (Handoff Mitglieder 2.5, 5a): In Schritt 1 Jahr und wer eine Mitteilung bekommt,
 * „Vorschau zeigen“ schreibt die Auswahl in die Adresse; Schritt 2 zeigt sie als Zeile mit „Ändern“, die Vorschau in
 * Gruppen und die Laufleiste mit „{n} Beiträge anlegen“.
 */
export function FeeRunFlow({ years, year, notices, preview, canStart }: { years: number[]; year: number | null; notices: Notices; preview: FeeRunPreview | null; canStart: boolean }) {
  const t = useTranslations('members.feeRun');
  const tm = useTranslations('members.form');
  const { date } = useDateFormat();
  const router = useRouter();
  const [selYear, setSelYear] = useState(String(year ?? years[0]));
  const [selNotices, setSelNotices] = useState<Notices>(notices);
  const [starting, setStarting] = useState(false);
  const feedback = useActionFeedback();

  const show = () => router.push(`/members/fees/run?year=${selYear}&notices=${selNotices}`);
  const start = async () => {
    if (!preview) return;
    setStarting(true);
    const result = await feedback.run(() => startFeeRunAction({ year: preview.year, notices }), { retry: () => void start() });
    if (result.status !== 'success') {
      setStarting(false);
      return;
    }
    router.push(`/members/fees/run?run=${(result.data as { id: string }).id}`);
  };

  if (!preview) {
    return (
      <div className="space-y-4">
        <RunSteps active="selection" />
        <form
          aria-label={t('selectionLabel')}
          className="flex flex-wrap items-end gap-4 rounded-md border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            show();
          }}
        >
          <FormField id="fee-run-year" label={t('year')}>
            <Select id="fee-run-year" className="w-auto" value={selYear} onChange={(e) => setSelYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </Select>
          </FormField>
          <FormField id="fee-run-notices" label={t('notices')}>
            <Segmented className="self-start" aria-label={t('notices')} value={selNotices} onValueChange={setSelNotices} options={[{ value: 'directDebitOnly', label: t('noticesDirectDebit') }, { value: 'all', label: t('noticesAll') }]} />
          </FormField>
          <Button type="submit">{t('show')}</Button>
          <p className="basis-full text-hint text-muted-ink">{t('noticesHint')}</p>
        </form>
      </div>
    );
  }

  const byGroup = GROUPS.map((key) => ({ key, items: preview.items.filter((i) => i.outcome === key) })).filter((g) => g.items.length > 0);
  const create = byGroup.find((g) => g.key === 'create')?.items ?? [];
  return (
    <div className="space-y-4">
      <RunSteps active="preview" />
      <div data-testid="run-selection-summary" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-ink">
          <span>{t('summary', { year: preview.year })}</span>
          <span className="text-ink-2">{t('notices')}: {notices === 'all' ? t('noticesAll') : t('noticesDirectDebit')}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/members/fees/run`)} disabled={starting}>{t('change')}</Button>
      </div>
      {preview.prenotificationLate.length > 0 ? <Notice level="warn">{t('prenotificationLate', { count: preview.prenotificationLate.length })}</Notice> : null}
      {preview.items.length === 0 ? (
        <EmptyState title={t('empty', { year: preview.year })} text={t('noticesHint')} />
      ) : (
        byGroup.map((group) => {
          const sum = group.items.reduce((s, i) => s + i.amountCents, 0);
          const members = new Set(group.items.map((i) => i.membershipId)).size;
          return (
            <section key={group.key} data-testid={`run-group-${group.key}`} aria-labelledby={`fee-group-${group.key}`} className="rounded-md border border-line bg-surface">
              <div className="px-4 pt-3 pb-2">
                <SectionHeading id={`fee-group-${group.key}`}>
                  <StatusBadge tone={group.key === 'noRule' ? 'warning' : 'neutral'}>{t(`groups.${group.key}`)}</StatusBadge> · {group.key === 'create' || group.key === 'exists' ? t('groupCount', { count: group.items.length, sum: formatEuro(sum) }) : t('groupMembers', { count: members })}
                </SectionHeading>
              </div>
              <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
                {group.items.map((item) => (
                  <li key={`${item.membershipId}-${item.periodStart}`} data-testid="run-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="font-semibold text-ink">{item.name}</span>
                      <span className="text-ink-2 tabular-nums">{item.memberNumber}</span>
                      <span className="text-muted-ink">{group.key === 'exempt' ? tm('feeExempt') : group.key === 'noRule' ? t('noRuleHint') : date(item.dueOn)}</span>
                    </span>
                    {group.key === 'create' || group.key === 'exists' ? <span className="tabular-nums text-ink">{formatEuro(item.amountCents)}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {canStart ? (
        // Die Laufleiste als eigene Karte unter den Gruppen (5a/6a); sie klebt wie die Speicherleiste.
        <FormCard>
        <FormActionBar
          mode="run"
          testId="run-footer"
          note={<span className="max-w-prose text-hint text-muted-ink">{t('humanOnly')}</span>}
          saveLabel={create.length > 0 ? t('footer', { count: create.length }) : t('footerNone')}
          saveDisabled={create.length === 0 || starting}
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
