'use client';

import type { RunPreview } from '@kompass/module-finance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { AmountField } from '@/components/finance/amount-field';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { numberRangeText, runIssueCount, runQueryString } from '@/lib/finance/run';
import { previewConfirmationRunAction, startConfirmationRunAction } from './actions';
import { PreviewGroups } from './preview-groups';
import { RunSteps } from './run-steps';
import { FormField } from '@/components/forms/form-field';

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
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const previewFb = useActionFeedback();
  const startFb = useActionFeedback();

  const recompute = async (next: { year: string; min: string; excluded: PickedContact[] }) => {
    const minCents = next.min.trim() ? parseAmount(next.min) : null;
    const input = {
      year: Number(next.year),
      ...(minCents !== null && minCents >= 0 ? { minCents } : {}),
      excludedContactIds: next.excluded.map((c) => c.id),
      ...(props.followUp ? { followUpOfRunId: props.followUp.id } : {}),
    };
    setLoading(true);
    const result = await previewFb.run(() => previewConfirmationRunAction(input), { retry: () => void recompute(next) });
    setLoading(false);
    if (result.status === 'error') return;
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
    setStarting(true);
    const result = await startFb.run(
      () =>
        startConfirmationRunAction({
          year: preview.year,
          minCents: preview.minCents,
          excludedContactIds: preview.excludedContactIds,
          ...(props.followUp ? { followUpOfRunId: props.followUp.id } : {}),
        }),
      { retry: () => void start() },
    );
    if (result.status === 'error') {
      setStarting(false);
      return;
    }
    if (result.status === 'success') {
      router.push(`/finance/donations/run?run=${(result.data as { id: string }).id}`);
    }
  };

  const count = preview ? runIssueCount(preview) : 0;
  const range = preview ? numberRangeText(preview.numberRange.from, count) : null;
  const canStart = props.canIssue && preview !== null && preview.blockedRun === null && count > 0 && !starting && !loading;

  return (
    <div className="space-y-4">
      <RunSteps active={preview ? 'preview' : 'selection'} />

      {props.followUp ? <Notice level="hint">{t('selection.followUp', { date: date(props.followUp.startedOn) })}</Notice> : null}

      <RefusalNotice action state={previewFb.state} />

      <form
        aria-label={t('selection.label')}
        className="flex flex-wrap items-end gap-4 rounded-md border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void recompute({ year, min, excluded });
        }}
      >
        <FormField id="run-year" label={t('selection.year')}>
          <Select
            id="run-year"
            className="w-auto"
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
        </FormField>
        <FormField id="run-min" label={t('selection.minimum')}>
          <AmountField id="run-min" name="min" value={min} onChange={setMin} />
        </FormField>
        {/* Breite wie das Suchfeld der Filterleisten in den Listen (Entscheidung zum Inventar). */}
        <div className="w-[220px]">
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
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t('selection.include', { name: c.name })} onClick={() => include(c.id)}>
                  <X aria-hidden />
                </Button>
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
          {preview.items.length === 0 && (preview.excluded ?? []).length === 0 ? (
            <EmptyState title={t('empty.title')} text={t('empty.text')} />
          ) : (
            // N3: auch wer ganz ausgeschlossen ist, bleibt sichtbar — mit Grund und der sperrenden Buchung.
            <PreviewGroups items={preview.items} excluded={preview.excluded ?? []} />
          )}

          {props.canIssue ? (
            <FormActionBar
              mode="run"
              testId="run-footer"
              note={
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <span>
                    <span className="text-muted-ink">{t('footer.range')}: </span>
                    <span data-testid="run-number-range" className="font-mono text-ink">
                      {range ? (range.to ? t('footer.rangeValue', { from: range.from, to: range.to }) : range.from) : t('footer.rangeNone')}
                    </span>
                  </span>
                  <span className="text-ink-2">{t('footer.issuedOn', { date: date(preview.issuedOn) })}</span>
                  <span className="max-w-prose text-[12px] text-muted-ink">{td('issue.humanOnly')}</span>
                </div>
              }
              saveLabel={t('footer.submit', { count })}
              saveDisabled={!canStart}
              pending={starting}
              onSave={() => void start()}
              state={startFb.state}
            />
          ) : (
            <p data-testid="run-footer" className="text-[13px] text-ink-2">{t('footer.noPermission')}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
