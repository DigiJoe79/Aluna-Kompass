'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';
import { DiscardRunDialog } from './discard-dialog';

export interface RunRawTransaction {
  id: string;
  bookingDate: string;
  counterpartyName: string | null;
  purpose: string;
  amountCents: number;
  state: 'open' | 'booked';
  entryId: string | null;
  entryNumber: string | null;
}

export interface RunRow {
  id: string;
  accountId: string;
  accountName: string;
  /** F4b: mit welchem Format gelesen — der Verlauf, auch nach einem Wechsel. */
  format: 'camt053' | 'csv';
  formatName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingCents: number | null;
  closingCents: number | null;
  counts: { new: number; known: number; held: number };
  gap: { from: string; to: string } | null;
  state: 'finished' | 'failed' | 'discarded';
  failure: { code: string; line: number | null } | null;
  startedAt: string;
  createdByUserName: string | null;
  rawTransactions: RunRawTransaction[];
}

const truncate = (text: string, max = 40): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Die Tabelle der hochgeladenen Auszüge (F4 Task 7, HANDOFF § 12.4) — ein
 * Protokoll, kein Arbeitsplatz: Konto · Zeitraum · Salden · Umsätze ·
 * geladen von/am · Zustand. Ein fehlgeschlagener Lauf nennt den Grund **in
 * der Zeile**. Jeder Lauf lässt sich aufklappen: seine Kontoumsätze, nur
 * lesend.
 */
export function RunsTable({ runs, canDiscard }: { runs: RunRow[]; canDiscard: boolean }) {
  const t = useTranslations('finance.imports.runs');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [discardTarget, setDiscardTarget] = useState<RunRow | null>(null);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (runs.length === 0) {
    return <p className="text-[13px] text-muted-ink">{t('empty')}</p>;
  }

  return (
    <div id="runs" className="space-y-3">
      {runs.map((run) => {
        const isOpen = open.has(run.id);
        return (
          <div key={run.id} data-testid="import-run" className="rounded-md border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-[13px]">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={t('detail.trigger')}
                onClick={() => toggle(run.id)}
                className="flex items-center gap-1.5 font-semibold text-ink"
              >
                <ChevronRight className={cn('size-4 shrink-0 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                {run.accountName}
              </button>
              <span className="text-ink-2">{run.periodFrom && run.periodTo ? t('period', { from: run.periodFrom, to: run.periodTo }) : '—'}</span>
              <span data-testid="import-run-format" className="text-muted-ink">{run.format === 'csv' ? (run.formatName ?? t('formatCsv')) : t('formatCamt')}</span>
              <span className="font-mono tabular-nums text-ink-2">
                {run.openingCents !== null ? t('opening', { amount: formatEuro(run.openingCents) }) : ''} {run.closingCents !== null ? t('closing', { amount: formatEuro(run.closingCents) }) : ''}
              </span>
              <span className="text-ink-2">{t('counts', { new: run.counts.new, known: run.counts.known, held: run.counts.held })}</span>
              <span className="text-muted-ink">{run.createdByUserName ? t('loadedBy', { name: run.createdByUserName, date: run.startedAt.slice(0, 10) }) : t('loadedByUnknown', { date: run.startedAt.slice(0, 10) })}</span>
              <span className="ml-auto rounded-sm bg-badge px-1.5 py-0.5 text-[11px] font-semibold text-badge-ink">{t(`state.${run.state}`)}</span>
              {canDiscard && run.state === 'finished' ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setDiscardTarget(run)}>
                  {t('discard')}
                </Button>
              ) : null}
            </div>

            {run.state === 'failed' && run.failure ? (
              <div className="px-3 pb-3">
                <p className="text-[13px] text-error">{run.failure.line !== null ? t('failure.line', { line: run.failure.line }) : t(`failure.codes.${run.failure.code}`)}</p>
              </div>
            ) : null}

            {run.gap ? (
              <div className="px-3 pb-3">
                <Notice level="warn">
                  {t('gap', { from: run.gap.from, to: run.gap.to })} {t('gapHint')}
                </Notice>
              </div>
            ) : null}

            {isOpen ? (
              <div className="border-t border-line px-3 py-2">
                {run.rawTransactions.length === 0 ? (
                  <p className="text-[13px] text-muted-ink">{t('detail.empty')}</p>
                ) : (
                  <ul className="divide-y divide-line text-[13px]">
                    {run.rawTransactions.map((raw) => (
                      <li key={raw.id} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="font-mono text-ink-2">{raw.bookingDate}</span>
                        <span className="flex-1 truncate">{raw.counterpartyName ?? '—'}</span>
                        <span className="flex-1 truncate text-muted-ink">{truncate(raw.purpose)}</span>
                        <span className="font-mono tabular-nums">{formatEuro(raw.amountCents)}</span>
                        <span>
                          {raw.state === 'booked' && raw.entryId ? (
                            <Link href={`/finance/entries/${raw.entryId}`} className="text-link">
                              {raw.entryNumber}
                            </Link>
                          ) : (
                            t('detail.state.open')
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      <DiscardRunDialog open={discardTarget !== null} onOpenChange={(next) => !next && setDiscardTarget(null)} run={discardTarget} />
    </div>
  );
}
