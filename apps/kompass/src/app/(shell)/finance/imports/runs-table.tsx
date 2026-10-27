'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { MutedMark, RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { countParts } from '@/lib/count-parts';
import { cn } from '@/lib/utils';
import { AmendBalanceDialog } from './amend-balance-dialog';
import { DiscardRunDialog } from './discard-dialog';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

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

  const formatLabel = (run: RunRow) => (run.format === 'csv' ? (run.formatName ?? t('formatCsv')) : t('formatCamt'));

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
            {/* Format ohne Rolle (Designer Runde 4, Frage 1; 214): Es unterscheidet die Läufe kaum („CAMT.053“), der
                Zeitraum schon. Es weicht wie Kontostand und Geladen (unter `lg`, mit Hilfe, am Telefon) und steht im
                aufgeklappten Lauf weiter. */}
            <TableHead>{t('columns.format')}</TableHead>
            <TableHead>{t('columns.balances')}</TableHead>
            <TableHead col="meta">{t('columns.counts')}</TableHead>
            <TableHead>{t('columns.loaded')}</TableHead>
            <TableHead col="status">{t('columns.state')}</TableHead>
            <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        {runs.map((run) => {
          const isOpen = open.has(run.id);
          const discarded = run.state === 'discarded';
          const noBalance = run.state === 'finished' && run.openingCents === null && run.closingCents === null;
          return (
            <TableBody key={run.id} data-testid="import-run" className="border-b border-line-2 last:border-0">
              {/* „verworfen“ ist ein Endzustand: gedämpfte Zeile mit Marke am Namen (MUSTER § G, Runde 4, 078). */}
              <TableRow muted={discarded ? t('state.discarded') : undefined}>
                <TableCell col="title" mutedMark="inline" className="text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-ink transition-transform', isOpen && 'rotate-90')} aria-hidden />
                    <RowButton aria-expanded={isOpen} aria-label={t('detail.trigger')} onClick={() => toggle(run.id)}>
                      {run.accountName}
                    </RowButton>
                  </span>
                  {/* „verworfen“ steht am Desktop immer als eigene Unterzeile, bündig mit dem Namen statt unter dem ›:
                      Einzug = Pfeil (1rem) + Abstand (0.375rem) − `ml-1` der Marke. Am Telefon (Kartenzeile) bleibt sie
                      hinter dem Namen (Designer Runde 4 Nachtrag, Frage 2; 078, 214). Einzelstelle, ohne Layout-Test. */}
                  {discarded ? <span className="md:block md:pl-4.5"><MutedMark /></span> : null}
                </TableCell>
                {/* Der Zeitraum ist ein Kennwert und steht einzeilig, wie ihn die Designer-Runden zuletzt sahen (Befund 47). */}
                <TableCell col="meta" className="tabular-nums text-ink-2">{run.periodFrom && run.periodTo ? t('period', { from: date(run.periodFrom), to: date(run.periodTo) }) : <Empty />}</TableCell>
                <TableCell data-testid="import-run-format" className="text-muted-ink">{formatLabel(run)}</TableCell>
                <TableCell className="tabular-nums text-ink-2">
                  {noBalance ? (
                    // Joe 2026-10-17: „Kontostand nachtragen“ steht dort, wo der Kontostand fehlt, nicht als breiter Knopf
                    // neben ⋯ — der schob die ganze Tabelle nach rechts hinaus (Runde 4, 078 und 214). Der sichtbare Text
                    // ist Teil des Namens („Kontostand nachtragen“), wie es WCAG 2.5.3 verlangt.
                    <span className="block">
                      <span className="block">{t('noBalance')}</span>
                      {canDiscard ? (
                        <Button type="button" variant="link" size="sm" className="h-auto p-0 underline" aria-label={t('amendBalance')} onClick={() => setAmendTarget(run)}>
                          {t('amendBalanceShort')}
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                  {/* Anfang und Ende brechen je als Ganzes um, nie mitten im Satzteil (Runde 4, 078). */}
                  {run.openingCents !== null ? <span className="whitespace-nowrap">{t('opening', { amount: formatEuro(run.openingCents) })}</span> : null}{' '}
                  {run.closingCents !== null ? <span className="whitespace-nowrap">{t('closing', { amount: formatEuro(run.closingCents) })}</span> : null}
                </TableCell>
                <TableCell col="meta" wrap className="text-ink-2">{countParts([[run.counts.new, t('countNew', { count: run.counts.new })], [run.counts.known, t('countKnown', { count: run.counts.known })], [run.counts.held, t('countHeld', { count: run.counts.held })]])}</TableCell>
                <TableCell className="text-muted-ink">
                  {/* Datum und Name je als Ganzes in einer eigenen Zeile, nie „17.10.2026 · Anna / Berger“ (Joe 2026-10-17). */}
                  <span className="block whitespace-nowrap tabular-nums">{date(run.startedAt)}</span>
                  {run.createdByUserName ? <span className="block whitespace-nowrap">{run.createdByUserName}</span> : null}
                </TableCell>
                <TableCell col="status">
                  {/* 07-1 A6 · 13 #12: Marke über `StatusBadge`; „fertig“ ist der Normalzustand und steht ohne Marke (§ F). */}
                  {isNormalInList('importRun', run.state) || discarded ? null : <StatusBadge tone={statusTone('importRun', run.state)}>{t(`state.${run.state}`)}</StatusBadge>}
                </TableCell>
                <TableCell col="actions" className="text-right">
                  <span className="inline-flex items-center justify-end">
                    <RowMenu
                      name={run.accountName}
                      items={[{ key: 'amend', label: t('amendBalance'), hidden: !(canDiscard && noBalance), onSelect: () => setAmendTarget(run) }, { key: 'discard', label: t('discard'), kind: 'delete', hidden: !(canDiscard && run.state === 'finished'), onSelect: () => setDiscardTarget(run) }]}
                    />
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
                    <p className="text-meta text-muted-ink" data-testid="import-run-detail-format">{t('detail.format', { format: formatLabel(run) })}</p>
                    {run.rawTransactions.length === 0 ? (
                      <p className="text-meta text-muted-ink">{t('detail.empty')}</p>
                    ) : (
                      // Feste Spalten über alle Zeilen (Joe, aufgeklappte Umsätze): Datum · Gegenpartei · Zweck · Betrag ·
                      // Buchung. Vorher war jede Zeile ein eigenes `flex` mit zwei `flex-1` — Zweck und Betrag rückten je
                      // nach Breite von „2026-0011“ oder „offen“ hin und her. Am Telefon oben Datum, Buchung und Betrag,
                      // darunter Gegenpartei und Zweck, die dort umbrechen statt zu kürzen. Einzelstelle, ohne Layout-Test.
                      <ul className="divide-y divide-line text-meta">
                        {run.rawTransactions.map((raw) => (
                          <li
                            key={raw.id}
                            className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 py-1.5 md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1.5fr)_7rem_6rem] md:items-center"
                          >
                            <span className="tabular-nums text-ink-2 max-md:col-start-1 max-md:row-start-1">{date(raw.bookingDate)}</span>
                            {/* Am Telefon fällt eine leere Gegenpartei samt Zeile weg, kein „—“ allein (Runde 4 Nachtrag, 217). */}
                            <span className={cn('max-md:col-span-3 max-md:row-start-2 md:truncate', raw.counterpartyName === null && 'max-md:hidden')} title={raw.counterpartyName ?? undefined}>{raw.counterpartyName ?? <Empty />}</span>
                            <span className="text-muted-ink max-md:col-span-3 max-md:row-start-3 md:truncate" title={raw.purpose}>{raw.purpose}</span>
                            <span className="text-right tabular-nums max-md:col-start-3 max-md:row-start-1">{formatEuro(raw.amountCents)}</span>
                            <span className="max-md:col-start-2 max-md:row-start-1">
                              {raw.state === 'booked' && raw.entryId ? (
                                <Link href={`/finance/entries/${raw.entryId}`} className="text-link">
                                  {raw.entryNumber}
                                </Link>
                              ) : (
                                // Gedämpft: Der Link zur Buchung bleibt das einzige Ziel in der Spalte (Runde 4 Nachtrag, 217).
                                <span className="text-muted-ink">{t('detail.state.open')}</span>
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
