'use client';

import type { DirectDebitPreview, DirectDebitPreviewItem } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Notice } from '@/components/notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { SectionHeading } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Steps, stepsFrom } from '@/components/steps';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatEuro } from '@/lib/finance/amount';
import { createRunAction, issueNoticeAction, previewRunAction } from '../../actions';

const STEP_KEYS = ['date', 'preview', 'created'] as const;

/**
 * Neuer Einzug (Handoff 2a § 1.2, 12a/12b): Schritte Fälligkeitstag · Vorschau · Angelegt. Wählbar sind nur die
 * Bankarbeitstage von der Einreichfrist der Bank bis ein Jahr voraus (`getCollectionWindow`), nach Monat gruppiert,
 * deshalb eine Auswahl statt eines freien Datumsfelds — ein Tag außerhalb braucht so keine Ablehnung. Die Vorschau
 * gruppiert nach Grund, mit Ausweg je Zeile und — bei „Ankündigung zu spät“ — dem frühesten gedeckten Tag an der Gruppe;
 * „Einzug anlegen“ nimmt nur, was eingezogen werden kann, und führt auf die Seite des Einzugs (13a).
 */
export function NewRunFlow({ days, accounts, defaultAccountId, canCreate }: { days: string[]; accounts: { id: string; name: string }[]; defaultAccountId: string; canCreate: boolean }) {
  const t = useTranslations('finance.directDebit.newRun');
  const tp = useTranslations('finance.directDebit.preview');
  const { date } = useDateFormat();
  const router = useRouter();
  const [day, setDay] = useState(days[0] ?? '');
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [preview, setPreview] = useState<DirectDebitPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const previewFb = useActionFeedback();
  const createFb = useActionFeedback();
  const accountName = accounts.find((a) => a.id === (preview?.accountId ?? accountId))?.name ?? '';

  const show = async (collectionDate = day) => {
    setLoading(true);
    const result = await previewFb.run(() => previewRunAction({ collectionDate, accountId }), { retry: () => void show(collectionDate) });
    setLoading(false);
    if (result.status === 'success') setPreview(result.data as DirectDebitPreview);
  };

  // Ausweg der Gruppe „Ankündigung zu spät“: der früheste Tag, an dem alle diese Posten gedeckt sind.
  const moveTo = (next: string) => {
    setDay(next);
    void show(next);
  };

  const months = days.reduce<{ key: string; days: string[] }[]>((groups, d) => {
    const key = d.slice(0, 7);
    if (groups.at(-1)?.key === key) groups.at(-1)!.days.push(d);
    else groups.push({ key, days: [d] });
    return groups;
  }, []);

  const create = async () => {
    if (!preview) return;
    setCreating(true);
    const result = await createFb.run(() => createRunAction({ collectionDate: preview.collectionDate, accountId: preview.accountId }), { retry: () => void create() });
    setCreating(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    router.push(`/finance/direct-debit/runs/${(result.data as { id: string }).id}`);
  };

  const steps = stepsFrom(STEP_KEYS.map((key) => ({ key, label: t(`steps.${key}`) })), preview ? 'preview' : 'date');
  const nothing = preview !== null && preview.included.length === 0 && preview.excluded.length === 0;

  return (
    <div className="space-y-4">
      <Steps label={t('steps.label')} steps={steps} testId="new-run-steps" />
      <RefusalNotice action state={previewFb.state} />

      {preview ? (
        <div data-testid="new-run-summary" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-body text-ink">
            <span>{t('summaryDue', { date: date(preview.collectionDate) })}</span>
            <span>{accountName}</span>
            <span>{t('summarySubmitBy', { from: date(preview.submitFrom), by: date(preview.submitBy) })}</span>
          </p>
          <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={creating}>{t('change')}</Button>
        </div>
      ) : (
        <form
          aria-label={t('steps.date')}
          className="rounded-md border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void show();
          }}
        >
          <FormGrid>
            <FormField id="run-day" label={t('day')} hint={t('dayHint')} size="s">
              <Select id="run-day" value={day} onChange={(e) => setDay(e.target.value)} data-testid="run-day">
                {months.map((m) => (
                  <optgroup key={m.key} label={t('month', { month: String(Number(m.key.slice(5))), year: m.key.slice(0, 4) })}>
                    {m.days.map((d) => (
                      <option key={d} value={d}>{date(d)}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </FormField>
            <FormField id="run-account" label={t('account')}>
              <Select id="run-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
          <Button type="submit" className="mt-4" disabled={loading || !day} data-testid="run-show-preview">{t('show')}</Button>
        </form>
      )}

      {preview && nothing ? <EmptyState title={tp('emptyTitle')} text={tp('empty', { date: date(preview.collectionDate) })} /> : null}
      {preview && !nothing ? <PreviewGroups preview={preview} onMoveTo={loading ? undefined : moveTo} /> : null}
      {/* M40: verpasste Raten verschwinden nicht still aus der Vorschau. */}
      {preview && preview.missedRates.length > 0 ? <Notice level="hint">{tp('missedRates', { count: preview.missedRates.length })}</Notice> : null}

      {preview && !nothing && canCreate ? (
        <FormActionBar
          mode="run"
          testId="new-run-footer"
          note={
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-ink">{t('footer', { date: date(preview.collectionDate), count: preview.totals.count, amount: formatEuro(preview.totals.sumCents) })}</span>
              <span className="max-w-prose text-hint text-muted-ink">{tp('note')}</span>
            </div>
          }
          saveLabel={t('create')}
          saveDisabled={preview.totals.count === 0}
          pending={creating}
          onSave={() => void create()}
          state={createFb.state}
        />
      ) : null}
    </div>
  );
}

/** Die Gruppen der Vorschau wie im Serienlauf (110): „Wird eingezogen“ mit Summe, dann je Grund mit Ausweg je Zeile. */
function PreviewGroups({ preview, onMoveTo }: { preview: DirectDebitPreview; onMoveTo?: (day: string) => void }) {
  const tp = useTranslations('finance.directDebit.preview');
  const tl = useTranslations('finance.directDebit.list');
  const { date } = useDateFormat();
  const feedback = useActionFeedback();
  const [issued, setIssued] = useState<Set<string>>(new Set());
  const keyOf = (item: DirectDebitPreviewItem) => `${item.source}-${item.sourceId}-${item.installmentOn ?? ''}`;

  const notice = async (item: DirectDebitPreviewItem) => {
    const result = await feedback.run(() => issueNoticeAction({ mandateId: item.mandateId, dueOn: item.coverOn, amountCents: item.amountCents }), { retry: () => void notice(item) });
    if (result.status !== 'success') return;
    toast.success(result.message);
    setIssued((prev) => new Set(prev).add(keyOf(item)));
  };

  const groups = [{ key: 'included' as const, items: preview.included }, ...preview.excluded.map((g) => ({ key: g.reason, items: g.items }))];
  return (
    <div className="space-y-4">
      <RefusalNotice action state={feedback.state} />
      {groups.map((group) => {
        if (group.items.length === 0) return null;
        const headingId = `dd-group-${group.key}`;
        const sum = group.items.reduce((s, i) => s + i.amountCents, 0);
        return (
          <section key={group.key} data-testid={`dd-group-${group.key}`} aria-labelledby={headingId} className="rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
              <SectionHeading id={headingId}>
                <StatusBadge tone={group.key === 'included' ? 'neutral' : 'warning'} dot={group.key !== 'included'}>{tp(`groups.${group.key}`)}</StatusBadge>{' '}
                · {group.key === 'included' ? tp('countSum', { count: group.items.length, amount: formatEuro(sum) }) : tp('count', { count: group.items.length })}
              </SectionHeading>
              {/* F8: Der gewählte Tag ist selbst erreichbar — heute ankündigen, dann ist er gedeckt. */}
              {group.key === 'noticeLate' && preview.noticeLateCoveredOn === preview.collectionDate ? (
                <span className="text-meta text-ink-2" data-testid="dd-announce-today">{tp('announceToday', { date: date(preview.collectionDate) })}</span>
              ) : group.key === 'noticeLate' && preview.noticeLateCoveredOn ? (
                <Button type="button" variant="outline" size="sm" disabled={!onMoveTo} onClick={() => onMoveTo?.(preview.noticeLateCoveredOn!)} data-testid="dd-move-day">
                  {tp('setDay', { date: date(preview.noticeLateCoveredOn) })}
                </Button>
              ) : null}
            </div>
            <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
              {group.items.map((item) => (
                <li key={keyOf(item)} data-testid="dd-preview-item" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-ink">{item.debtorName}</span>
                    <span className="text-ink-2">{item.source === 'pledge' && item.installmentOn ? tl('rateOf', { date: date(item.installmentOn) }) : item.remittance}</span>
                    {group.key === 'mandateInactive' ? <span className="text-muted-ink">{tp('mandateState', { reference: item.mandateReference, state: tp(`mandateStates.${item.mandateState}`) })}</span> : null}
                    {group.key === 'noticeLate' ? <span className="text-muted-ink">{tp('noticeFrom', { date: date(preview.noticeCoversFrom) })}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {group.key === 'mandateInactive' ? (
                      <Link href={`/finance/direct-debit/mandates/${item.mandateId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{tp('openMandate')}</Link>
                    ) : null}
                    {group.key === 'noticeLate' ? (
                      issued.has(keyOf(item)) ? (
                        <span className="text-hint text-ink-2">{tp('noticeDone')}</span>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={() => void notice(item)}>{tp('createNotice')}</Button>
                      )
                    ) : null}
                    {group.key === 'inOtherRun' ? <span className="text-hint text-ink-2">{tp('inOtherRunHint')}</span> : null}
                    <span className="tabular-nums text-ink">{formatEuro(item.amountCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
