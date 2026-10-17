'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';
import { AmendBalanceDialog } from './amend-balance-dialog';
import { DiscardRunDialog } from './discard-dialog';
import { Empty } from '@/components/empty-value';

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
  /** Befund 5: nur `futureDates` bisher — angenommen, kein Ablehnungsgrund. */
  warnings: ('futureDates')[];
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
  const { date } = useDateFormat();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [discardTarget, setDiscardTarget] = useState<RunRow | null>(null);
  const [amendTarget, setAmendTarget] = useState<RunRow | null>(null);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (runs.length === 0) {
    return <p className="text-meta text-muted-ink">{t('empty')}</p>;
  }

  // 07-1 B19: eine Tabelle mit Spalten (§ G) statt Flex-Karten. Jeder Lauf ist ein eigener `tbody` — Hauptzeile,
  // darunter Grund, Lücke, Warnung und die aufgeklappten Kontoumsätze über die ganze Breite.
  const COLUMNS = 8;
  return (
    <div id="runs" className="overflow-x-auto rounded-md border border-line">
      <Table data-testid="import-runs">
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.account')}</TableHead>
            <TableHead col="meta">{t('columns.period')}</TableHead>
            <TableHead col="meta">{t('columns.format')}</TableHead>
            <TableHead>{t('columns.balances')}</TableHead>
            <TableHead col="meta">{t('columns.counts')}</TableHead>
            <TableHead>{t('columns.loaded')}</TableHead>
            <TableHead col="status">{t('columns.state')}</TableHead>
            <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        {runs.map((run) => {
          const isOpen = open.has(run.id);
          const noBalance = run.state === 'finished' && run.openingCents === null && run.closingCents === null;
          return (
            <TableBody key={run.id} data-testid="import-run" className="border-b border-line-2 last:border-0">
              <TableRow>
                <TableCell col="title" className="text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-ink transition-transform', isOpen && 'rotate-90')} aria-hidden />
                    <RowButton aria-expanded={isOpen} aria-label={t('detail.trigger')} onClick={() => toggle(run.id)}>
                      {run.accountName}
                    </RowButton>
                  </span>
                </TableCell>
                <TableCell col="meta" className="tabular-nums text-ink-2">{run.periodFrom && run.periodTo ? t('period', { from: date(run.periodFrom), to: date(run.periodTo) }) : <Empty />}</TableCell>
                <TableCell col="meta" data-testid="import-run-format" className="text-muted-ink">{run.format === 'csv' ? (run.formatName ?? t('formatCsv')) : t('formatCamt')}</TableCell>
                <TableCell className="tabular-nums text-ink-2">
                  {noBalance ? t('noBalance') : null}
                  {run.openingCents !== null ? t('opening', { amount: formatEuro(run.openingCents) }) : ''} {run.closingCents !== null ? t('closing', { amount: formatEuro(run.closingCents) }) : ''}
                </TableCell>
                <TableCell col="meta" className="text-ink-2">{t('counts', { new: run.counts.new, known: run.counts.known, held: run.counts.held })}</TableCell>
                <TableCell className="text-muted-ink">{run.createdByUserName ? t('loadedBy', { name: run.createdByUserName, date: date(run.startedAt) }) : t('loadedByUnknown', { date: date(run.startedAt) })}</TableCell>
                <TableCell col="status">
                  {/* 07-1 A6 · 13 #12: Marke über `StatusBadge`; „fertig“ ist der Normalzustand und steht ohne Marke (§ F). */}
                  {isNormalInList('importRun', run.state) ? null : <StatusBadge tone={statusTone('importRun', run.state)}>{t(`state.${run.state}`)}</StatusBadge>}
                </TableCell>
                <TableCell col="actions" className="text-right">
                  <span className="inline-flex gap-2">
                    {canDiscard && noBalance ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setAmendTarget(run)}>
                        {t('amendBalance')}
                      </Button>
                    ) : null}
                    {/* 07-1 B20: Löschknopf in einer Zeile ist `outline` (§ C). */}
                    {canDiscard && run.state === 'finished' ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setDiscardTarget(run)}>
                        {t('discard')}
                      </Button>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>

              {run.state === 'failed' && run.failure ? (
                <TableRow>
                  <TableCell col="span" colSpan={COLUMNS} className="whitespace-normal">
                    <Notice level="refuse">{run.failure.line !== null ? t('failure.line', { line: run.failure.line }) : t(`failure.codes.${run.failure.code}`)}</Notice>
                  </TableCell>
                </TableRow>
              ) : null}

              {run.gap ? (
                <TableRow>
                  <TableCell col="span" colSpan={COLUMNS} className="whitespace-normal">
                    <Notice level="warn">
                      {t('gap', { from: date(run.gap.from), to: date(run.gap.to) })} {t('gapHint')}
                    </Notice>
                  </TableCell>
                </TableRow>
              ) : null}

              {run.warnings.includes('futureDates') ? (
                <TableRow>
                  <TableCell col="span" colSpan={COLUMNS} className="whitespace-normal">
                    <Notice level="warn">{t('warnings.futureDates')}</Notice>
                  </TableCell>
                </TableRow>
              ) : null}

              {isOpen ? (
                <TableRow>
                  <TableCell col="span" colSpan={COLUMNS} className="whitespace-normal">
                    {run.rawTransactions.length === 0 ? (
                      <p className="text-meta text-muted-ink">{t('detail.empty')}</p>
                    ) : (
                      <ul className="divide-y divide-line text-meta">
                        {run.rawTransactions.map((raw) => (
                          <li key={raw.id} className="flex items-center justify-between gap-3 py-1.5">
                            <span className="tabular-nums text-ink-2">{date(raw.bookingDate)}</span>
                            <span className="flex-1 truncate">{raw.counterpartyName ?? <Empty />}</span>
                            <span className="flex-1 truncate text-muted-ink">{truncate(raw.purpose)}</span>
                            <span className="tabular-nums">{formatEuro(raw.amountCents)}</span>
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
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          );
        })}
      </Table>

      <DiscardRunDialog open={discardTarget !== null} onOpenChange={(next) => !next && setDiscardTarget(null)} run={discardTarget} />
      <AmendBalanceDialog open={amendTarget !== null} onOpenChange={(next) => !next && setAmendTarget(null)} run={amendTarget} />
    </div>
  );
}
