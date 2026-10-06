'use client';

import type { PurposeOverviewRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { StatusBadge, type BadgeTone } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { PurposeDetail } from './purpose-detail';

const STATE_TONE: Record<PurposeOverviewRow['state'], BadgeTone> = { open: 'info', fulfilled: 'success', dissolved: 'neutral' };

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
    if (row.targetCents === null) return <span className="text-muted-ink">—</span>;
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
      <StatusBadge tone={STATE_TONE[row.state]}>{t(`states.${row.state}`)}</StatusBadge>
      {row.negative ? <StatusBadge tone="warning" dot>{t('badges.negative')}</StatusBadge> : null}
      {row.fulfilledWithRest ? <StatusBadge tone="warning" dot>{t('badges.fulfilledWithRest', { amount: formatEuro(row.balanceCents) })}</StatusBadge> : null}
    </div>
  );

  const money = (cents: number) => <span className="font-mono tabular-nums">{formatEuro(cents)}</span>;
  const net = (row: PurposeOverviewRow) => {
    const transfersIn = row.transfersInCents ?? 0;
    const transfersOut = row.transfersOutCents ?? 0;
    const n = transfersIn - transfersOut;
    if (transfersIn === 0 && transfersOut === 0) return <span className="text-muted-ink">—</span>;
    return <span className="font-mono tabular-nums">{n > 0 ? `+${formatEuro(n)}` : formatEuro(n)}</span>;
  };

  return (
    <div className="space-y-4">
      {canTransfer ? (
        <div className="flex justify-end">
          <Link href="/finance/purposes/transfer" className={buttonVariants()} data-testid="purposes-transfer-trigger">
            {t('detail.transfer')}
          </Link>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-line">
        <Table data-testid="purposes-table">
          <TableHeader>
            <TableRow>
              <TableHead className="px-3">{t('columns.name')}</TableHead>
              {full ? <TableHead className="px-3">{t('columns.project')}</TableHead> : null}
              <TableHead className="px-3">{t('columns.target')}</TableHead>
              {full ? (
                <>
                  <TableHead className="px-3 text-right">{t('columns.carryForward')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.inflow')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.outflow')}</TableHead>
                  <TableHead className="px-3 text-right">{t('columns.transfers')}</TableHead>
                </>
              ) : null}
              <TableHead className="px-3 text-right">{t('columns.balance')}</TableHead>
              <TableHead className="px-3">{t('columns.state')}</TableHead>
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
                <TableCell className="px-3 font-medium text-ink">
                  {full ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <RowButton aria-expanded={row.id === selectedId} onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}>
                        {row.name}
                      </RowButton>
                      {/* Entscheidung 7: Ausland als Kennzeichen am Namen statt eigener Spalte. */}
                      {row.abroad ? <span data-testid="purpose-abroad"><StatusBadge tone="neutral">{t('abroadYes')}</StatusBadge></span> : null}
                    </span>
                  ) : (
                    row.name
                  )}
                </TableCell>
                {full ? <TableCell className="px-3 text-ink-2">{row.projectId ? projects[row.projectId] ?? '—' : '—'}</TableCell> : null}
                <TableCell className="px-3">{target(row)}</TableCell>
                {full ? (
                  <>
                    <TableCell className="px-3 text-right text-ink-2">{money(row.carryForwardCents ?? 0)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{money(row.inflowCents ?? 0)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{money(row.outflowCents ?? 0)}</TableCell>
                    <TableCell className="px-3 text-right text-ink-2">{net(row)}</TableCell>
                  </>
                ) : null}
                <TableCell className={`px-3 text-right font-semibold ${row.negative ? 'text-warning' : 'text-ink'}`} data-testid="purpose-balance">
                  {money(row.balanceCents)}
                </TableCell>
                <TableCell className="px-3">{stateCell(row)}</TableCell>
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
