'use client';

import type { RunPreview } from '@kompass/module-finance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { AmountField } from '@/components/finance/amount-field';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { isBeforeOldestNotice, numberRangeText, runIssueCount, runQueryString } from '@/lib/finance/run';
import { previewConfirmationRunAction, startConfirmationRunAction } from './actions';
import { PreviewGroups } from './preview-groups';
import { RunSteps } from './run-steps';

export interface RunSelectionProps {
  years: number[];
  defaultYear: number;
  year: number | null;
  minCents: number | null;
  excluded: PickedContact[];
  followUp: { id: string; startedOn: string } | null;
  preview: RunPreview | null;
  canIssue: boolean;
}

/**
 * Auswahl und Vorschau des Serienlaufs (README 3i). Die Auswahl steht als
 * Leiste über der Vorschau; jede Änderung rechnet die Vorschau über eine
 * Server Action neu und schreibt die Auswahl in die Adresse, damit ein
 * Neuladen dieselbe Vorschau zeigt. Die Fußleiste klebt: Nummernbereich,
 * „nur ein Mensch“ und „{n} Bestätigungen ausstellen“.
 */
export function RunSelection(props: RunSelectionProps) {
  const t = useTranslations('finance.donations.run');
  const td = useTranslations('finance.donations');
  const { date } = useDateFormat();
  const router = useRouter();
  const [year, setYear] = useState(String(props.year ?? props.defaultYear));
  const [min, setMin] = useState(props.minCents !== null ? formatAmount(props.minCents) : '');
  const [excluded, setExcluded] = useState<PickedContact[]>(props.excluded);
  const [picker, setPicker] = useState<PickedContact | null>(null);
  const [preview, setPreview] = useState<RunPreview | null>(props.preview);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  const recompute = async (next: { year: string; min: string; excluded: PickedContact[] }) => {
    const minCents = next.min.trim() ? parseAmount(next.min) : null;
    const input = {
      year: Number(next.year),
      ...(minCents !== null && minCents >= 0 ? { minCents } : {}),
      excludedContactIds: next.excluded.map((c) => c.id),
      ...(props.followUp ? { followUpOfRunId: props.followUp.id } : {}),
    };
    setLoading(true);
    const result = await previewConfirmationRunAction(input);
    setLoading(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      setPreview(result.data as RunPreview);
      const query = runQueryString({ year: input.year, minCents: input.minCents ?? null, excluded: input.excludedContactIds, followUp: props.followUp?.id ?? null });
      window.history.replaceState(null, '', `/finance/donations/run${query}`);
    }
  };

  const exclude = (contact: PickedContact | null) => {
    setPicker(null);
    if (!contact || excluded.some((c) => c.id === contact.id)) return;
    const next = [...excluded, { id: contact.id, name: contact.name }];
    setExcluded(next);
    void recompute({ year, min, excluded: next });
  };

  const include = (id: string) => {
    const next = excluded.filter((c) => c.id !== id);
    setExcluded(next);
    void recompute({ year, min, excluded: next });
  };

  const start = async () => {
    if (!preview) return;
    const early = preview.items.some(isBeforeOldestNotice) && reason.trim() ? reason.trim() : undefined;
    setStarting(true);
    const result = await startConfirmationRunAction({
      year: preview.year,
      minCents: preview.minCents,
      excludedContactIds: preview.excludedContactIds,
      ...(props.followUp ? { followUpOfRunId: props.followUp.id } : {}),
      ...(early ? { preNoticeReason: early } : {}),
    });
    if (result.status === 'error') {
      setStarting(false);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.push(`/finance/donations/run?run=${(result.data as { id: string }).id}`);
    }
  };

  const count = preview ? runIssueCount(preview, reason) : 0;
  const range = preview ? numberRangeText(preview.numberRange.from, count) : null;
  const canStart = props.canIssue && preview !== null && preview.blockedRun === null && count > 0 && !starting && !loading;

  return (
    <div className="space-y-4">
      <RunSteps active={preview ? 'preview' : 'selection'} />

      {props.followUp ? <Notice level="hint">{t('selection.followUp', { date: date(props.followUp.startedOn) })}</Notice> : null}

      <form
        aria-label={t('selection.label')}
        className="flex flex-wrap items-end gap-4 rounded-md border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void recompute({ year, min, excluded });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="run-year">{t('selection.year')}</Label>
          <Select
            id="run-year"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              if (preview) void recompute({ year: e.target.value, min, excluded });
            }}
          >
            {props.years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="run-min">{t('selection.minimum')}</Label>
          <AmountField id="run-min" name="min" value={min} onChange={setMin} />
        </div>
        <div className="w-72">
          <ContactPicker id="run-exclude" name="exclude" label={t('selection.exclude')} value={picker} onChange={exclude} />
        </div>
        <Button type="submit" variant={preview ? 'outline' : 'default'} disabled={loading}>
          {preview ? t('selection.apply') : t('selection.show')}
        </Button>
        <p className="basis-full text-[12px] text-muted-ink">{t('selection.minimumHint')}</p>
        {excluded.length > 0 ? (
          <div data-testid="run-excluded" className="flex basis-full flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-2">{t('selection.excluded')}:</span>
            {excluded.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 py-0.5 pr-1 pl-2">
                {c.name}
                <button type="button" aria-label={t('selection.include', { name: c.name })} className="rounded-sm p-0.5 text-muted-ink hover:bg-surface hover:text-ink" onClick={() => include(c.id)}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </form>

      {preview ? (
        <>
          {preview.blockedRun ? (
            <Notice level="refuse" title={t('blockedRun.title')} remedies={[{ label: td(`remedy.${preview.blockedRun.remedy.labelKey}`), href: preview.blockedRun.remedy.href }]}>
              {t(`blockedRun.${preview.blockedRun.reason}`)}
            </Notice>
          ) : null}
          {preview.items.length === 0 ? (
            <EmptyState title={t('empty.title')} text={t('empty.text')} />
          ) : (
            <PreviewGroups items={preview.items} reason={reason} onReasonChange={setReason} canIssue={props.canIssue} />
          )}

          <div data-testid="run-footer" className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-surface px-4 py-3 shadow-md">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
              <span>
                <span className="text-muted-ink">{t('footer.range')}: </span>
                <span data-testid="run-number-range" className="font-mono text-ink">
                  {range ? (range.to ? t('footer.rangeValue', { from: range.from, to: range.to }) : range.from) : t('footer.rangeNone')}
                </span>
              </span>
              <span className="text-ink-2">{t('footer.issuedOn', { date: date(preview.issuedOn) })}</span>
              {props.canIssue ? <span className="max-w-[320px] text-[12px] text-muted-ink">{td('issue.humanOnly')}</span> : null}
            </div>
            {props.canIssue ? (
              <Button type="button" disabled={!canStart} onClick={() => void start()}>
                {t('footer.submit', { count })}
              </Button>
            ) : (
              <p className="text-[13px] text-ink-2">{t('footer.noPermission')}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
