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
import { formatAmount, formatEuro, readAmount } from '@/lib/finance/amount';
import { numberRangeText, openRunSummary, runIssueCount, runQueryString } from '@/lib/finance/run';
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
  // Mindestbetrag optional; unlesbar rechnet die Vorschau nicht still ohne Grenze, sondern bleibt beim letzten Stand und
  // zeigt den Fehler am Feld (App-B7) — ausgestellt wird immer, was die Vorschau zeigt.
  const [minInvalid, setMinInvalid] = useState(false);

  const recompute = async (next: { year: string; min: string; excluded: PickedContact[] }) => {
    const read = readAmount(next.min, { required: false });
    setMinInvalid(!read.ok);
    if (!read.ok) return;
    const minCents = read.cents;
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

  // Runde 3, 109/110: Die Auswahl gilt erst mit „Vorschau zeigen“ — Schritt 1 rechnet nicht nebenbei.
  const exclude = (contact: PickedContact | null) => {
    setPicker(null);
    if (!contact || excluded.some((c) => c.id === contact.id)) return;
    setExcluded([...excluded, { id: contact.id, name: contact.name }]);
  };

  const include = (id: string) => {
    setExcluded(excluded.filter((c) => c.id !== id));
  };

  // „Ändern“ führt zurück in Schritt 1; die Auswahl bleibt, die Vorschau rechnet beim nächsten „Vorschau zeigen“ neu.
  const change = () => {
    setPreview(null);
    startFb.reset();
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
  const open = preview ? openRunSummary(preview.items) : { count: 0, reasons: [] };
  const canStart = props.canIssue && preview !== null && preview.blockedRun === null && count > 0 && !starting && !loading;

  return (
    <div className="space-y-4">
      <RunSteps active={preview ? 'preview' : 'selection'} />

      {props.followUp ? <Notice level="hint">{t('selection.followUp', { date: date(props.followUp.startedOn) })}</Notice> : null}

      <RefusalNotice action state={previewFb.state} />

      {preview ? (
        // Runde 3, 109/110 (Joe 2026-10-17): In Schritt 2 steht die Auswahl als Zusammenfassung, „Ändern“ führt zurück.
        <div data-testid="run-selection-summary" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-ink">
            <span>{t('selection.summaryYear', { year: preview.year })}</span>
            <span className="text-ink-2">{preview.minCents !== null && preview.minCents > 0 ? t('selection.summaryMinimum', { amount: formatEuro(preview.minCents) }) : t('selection.summaryNoMinimum')}</span>
            {excluded.length > 0 ? (
              <span data-testid="run-excluded" className="text-ink-2">{t('selection.excluded')}: {excluded.map((c) => c.name).join(', ')}</span>
            ) : null}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={change} disabled={starting}>
            {t('selection.change')}
          </Button>
        </div>
      ) : (
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
            onChange={(e) => setYear(e.target.value)}
          >
            {props.years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </Select>
        </FormField>
        <FormField id="run-min" label={t('selection.minimum')}>
          <AmountField id="run-min" name="min" value={min} onChange={setMin} invalid={minInvalid} />
        </FormField>
        {/* Breite wie das Suchfeld der Filterleisten in den Listen (Entscheidung zum Inventar). */}
        <div className="w-[220px]">
          <ContactPicker id="run-exclude" name="exclude" label={t('selection.exclude')} value={picker} onChange={exclude} />
        </div>
        <Button type="submit" disabled={loading}>
          {t('selection.show')}
        </Button>
        <p className="basis-full text-hint text-muted-ink">{t('selection.minimumHint')}</p>
        {excluded.length > 0 ? (
          <div data-testid="run-excluded" className="flex basis-full flex-wrap items-center gap-2 text-meta">
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
      )}

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
                  {count === 0 && open.count > 0 ? null : (
                    <span>
                      <span className="text-muted-ink">{t('footer.range')}: </span>
                      <span data-testid="run-number-range" className="font-mono text-ink">
                        {range ? (range.to ? t('footer.rangeValue', { from: range.from, to: range.to }) : range.from) : t('footer.rangeNone')}
                      </span>
                    </span>
                  )}
                  <span className="text-ink-2">{t('footer.issuedOn', { date: date(preview.issuedOn) })}</span>
                  <span className="max-w-prose text-hint text-muted-ink">{td('issue.humanOnly')}</span>
                </div>
              }
              // 09 A5, Runde 3 110: Ist nichts ausstellbar, steht der Grund als Text neben dem gesperrten Knopf (E2) — was offen
              // ist und warum, nicht „keine Nummer“.
              extraActions={
                count === 0 && open.count > 0 ? (
                  <span data-testid="run-open-summary" className="self-center text-meta text-ink">
                    {t('footer.open', { count: open.count, reasons: open.reasons.map((r) => t(`blockedBy.${r}`)).join(', ') })}
                  </span>
                ) : undefined
              }
              saveLabel={count > 0 ? t('footer.submit', { count }) : t('footer.submitNone')}
              saveDisabled={!canStart}
              pending={starting}
              onSave={() => void start()}
              state={startFb.state}
            />
          ) : (
            <p data-testid="run-footer" className="text-meta text-ink-2">{t('footer.noPermission')}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
