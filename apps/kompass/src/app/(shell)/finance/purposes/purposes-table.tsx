'use client';

import type { PurposeOverviewRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { PurposeDetail } from './purpose-detail';
import { Empty } from '@/components/empty-value';


/**
 * E3 „Zwecke“ (F8b Task 6a, Designer-README 4c): Zweck · Projekt · Ziel ·
 * Vortrag · Zugänge · Verwendung · Umwidmungen · Bestand · Zustand mit den
 * Warn-Badges „im Minus“ und „erfüllt, n € Rest“; Ziel als „x von y“,
 * Ausland als Kennzeichen am Namen (Entscheidung 7, 2026-09-28 — die Spalte
 * „Umwidmungen“ bleibt als Vorstufe der Mittelverwendungsrechnung). Ohne `full` (nur
 * `finance.overview`) nur Zweck, Ziel, Bestand und Zustand — die Zeile öffnet
 * nichts.
 */
export function PurposesTable({
  rows,
  projects,
  full,
  canTransfer,
  canSetup,
}: {
  rows: PurposeOverviewRow[];
  projects: Record<string, string>;
  full: boolean;
  canTransfer: boolean;
  canSetup: boolean;
}) {
  const t = useTranslations('finance.purposes');
  const tLimit = useTranslations('finance.limitProgress');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = full ? rows.find((r) => r.id === selectedId) ?? null : null;

  const target = (row: PurposeOverviewRow) => {
    if (row.targetCents === null) return <span className="text-muted-ink"><Empty /></span>;
    const state = limitState({ valueCents: row.balanceCents, limitCents: row.targetCents, warnAtPercent: 100, kind: 'target' });
    return (
      <div className="min-w-[120px]">
        <LimitProgress
          coveredCents={Math.max(0, row.balanceCents)}
          totalCents={row.targetCents}
          label={t('targetLabel')}
          hideLabel
          figure={tLimit('figure', { value: formatEuro(row.balanceCents), limit: formatEuro(row.targetCents) })}
          state={state === 'reached' ? state : null}
          stateLabel={state === 'reached' ? tLimit('states.reached') : undefined}
        />
      </div>
    );
  };

  const stateCell = (row: PurposeOverviewRow) => (
    <div className="flex flex-wrap gap-1">
      {/* 09 A2 · 09 A1: Bei „erfüllt mit Rest“ steht „erfüllt“ nur einmal — in der Marke mit dem Rest. */}
      {isNormalInList('purpose', row.state) || row.fulfilledWithRest ? null : <StatusBadge tone={statusTone('purpose', row.state)}>{t(`states.${row.state}`)}</StatusBadge>}
      {row.negative ? <StatusBadge tone={statusTone('purposeBalance', 'negative')} dot>{t('badges.negative')}</StatusBadge> : null}
      {row.fulfilledWithRest ? <StatusBadge tone={statusTone('purposeBalance', 'fulfilledWithRest')} dot>{t('badges.fulfilledWithRest', { amount: formatEuro(row.balanceCents) })}</StatusBadge> : null}
    </div>
  );

  const money = (cents: number) => <span className="tabular-nums">{formatEuro(cents)}</span>;
  const movement = (cents: number | null | undefined) => (cents ? money(cents) : <span className="text-muted-ink"><Empty /></span>);
  const net = (row: PurposeOverviewRow) => {
    const transfersIn = row.transfersInCents ?? 0;
    const transfersOut = row.transfersOutCents ?? 0;
    const n = transfersIn - transfersOut;
    if (transfersIn === 0 && transfersOut === 0) return <span className="text-muted-ink"><Empty /></span>;
    return <span className="tabular-nums">{formatEuro(n, { sign: 'always' })}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-line">
        <Table data-testid="purposes-table">
          <TableHeader>
            <TableRow>
              <TableHead col="title" className="px-3">{t('columns.name')}</TableHead>
              {full ? <TableHead className="px-3">{t('columns.project')}</TableHead> : null}
              <TableHead col="meta" className="px-3">{t('columns.target')}</TableHead>
              {full ? (
                <>
                  <TableHead className="px-3 text-right">{t('columns.carryForward')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.inflow')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.outflow')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.transfers')}</TableHead>
                </>
              ) : null}
              <TableHead col="amount" className="px-3 text-right">{t('columns.balance')}</TableHead>
              <TableHead col="status" className="px-3">{t('columns.state')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="purpose-row"
                data-selected={row.id === selectedId ? 'true' : undefined}
                data-state={row.id === selectedId ? 'selected' : undefined}
              >
                <TableCell col="title" className="px-3 text-ink">
                  {full ? (
                    <>
                      <RowButton aria-expanded={row.id === selectedId} onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}>
                        {row.name}
                      </RowButton>
                      {/* Ausland ist eine Eigenschaft, keine Abweichung: Text in der Unterzeile statt Marke (Runde 3, 120;
                          Entscheidung 7: keine eigene Spalte). */}
                      {row.abroad ? <span data-testid="purpose-abroad" className="block text-hint text-muted-ink">{t('abroadYes')}</span> : null}
                    </>
                  ) : (
                    row.name
                  )}
                </TableCell>
                {full ? <TableCell className="px-3 text-ink-2">{row.projectId ? projects[row.projectId] ?? <Empty /> : <Empty />}</TableCell> : null}
                <TableCell col="meta" className="px-3">{target(row)}</TableCell>
                {full ? (
                  <>
                    {/* Leere Bewegungen einheitlich „—“ wie die Umwidmungen, keine 0,00 € (Runde 3, 120). Der Bestand bleibt ein
                        Betrag, auch bei 0. */}
                    <TableCell className="px-3 text-right text-ink-2">{movement(row.carryForwardCents)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{movement(row.inflowCents)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{movement(row.outflowCents)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{net(row)}</TableCell>
                  </>
                ) : null}
                <TableCell col="amount" className="px-3 text-right font-semibold text-ink" data-testid="purpose-balance">
                  {money(row.balanceCents)}
                </TableCell>
                <TableCell col="status" className="px-3">{stateCell(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selected ? (
        <PurposeDetail
          key={`${selected.id}-${selected.updatedAt}`}
          row={selected}
          projectName={selected.projectId ? projects[selected.projectId] ?? null : null}
          canTransfer={canTransfer}
          canSetup={canSetup}
        />
      ) : null}

    </div>
  );
}
