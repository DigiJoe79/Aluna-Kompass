'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, filterControlClass, type FilterSlot } from '@/components/filter-bar';
import { Overline } from '@/components/overline';
import { PageHeader } from '@/components/page-header';
import { RowMenu, type RowMenuItem } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MutedMark, RowButton, Table, TableBody, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { EndDialog } from './end-dialog';
import { OtherAssetDialog } from './other-asset-dialog';
import { RevalueDialog } from './revalue-dialog';

export interface OtherAssetRow {
  id: string;
  kind: 'asset' | 'liability';
  label: string;
  valueCents: number;
  basis: string;
  recordedFrom: string;
  recordedUntil: string | null;
  endReason: string | null;
  documentId: string | null;
  /** Nummer und Betreff des Belegs, wenn die Akte ihn dieser Person zeigt. */
  documentNumber?: string | null;
  documentSubject?: string | null;
  updatedAt: string;
}

const KINDS = ['asset', 'liability'] as const;
type Open = { kind: 'edit' | 'revalue' | 'end' | 'view'; row: OtherAssetRow } | { kind: 'create' } | null;

/**
 * Sonstiges Vermögen (Board 11e, aufgebaut wie „Zurückgelegtes Geld“): Satz unter dem Titel, „Eintrag anlegen“ rechts,
 * „Stand am“ in der `FilterBar` (ein Rahmen wie das Jahr, kein gesetzter Filter), zwei `TableGroupRow` mit Summe, ⋯ je
 * Zeile. Beendete Einträge zugeklappt darunter wie „Stillgelegt“ bei Konten. Mit nur `finance.overview` kein Knopf und
 * im ⋯ nur „Beleg öffnen“.
 */
export function OtherAssetList({ rows, ended, date, today, canWrite, hasAny }: { rows: OtherAssetRow[]; ended: OtherAssetRow[]; date: string; today: string; canWrite: boolean; hasAny: boolean }) {
  const t = useTranslations('finance.otherAssets');
  const tMuted = useTranslations('common.muted');
  const fmt = useDateFormat();
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const [open, setOpen] = useState<Open>(null);
  const go = (value: string) => startNavigation(() => router.replace(value && value !== today ? `/finance/other-assets?date=${value}` : '/finance/other-assets'));

  const dateField = (value: string, onChange: (v: string) => void, id: string) => (
    // Mit sichtbarem Label „Stand am“ (Designer Runde 7, 250): ein Datum ohne Wort davor sagt nicht, wofür es steht.
    <span className="flex items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-meta text-muted-ink">
        {t('date')}
      </Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`w-[160px] ${filterControlClass(false)}`} />
    </span>
  );
  const dateSlot: FilterSlot = {
    key: 'date',
    label: t('date'),
    active: false,
    onClear: () => undefined,
    control: dateField(date, go, 'other-assets-date'),
    sheet: { value: date, render: (value, onChange) => dateField(value, onChange, 'other-assets-date-sheet'), apply: go },
  };

  const menu = (row: OtherAssetRow): RowMenuItem[] => {
    const active = row.recordedUntil === null;
    return [
      { key: 'edit', label: t('menu.edit'), onSelect: () => setOpen({ kind: 'edit', row }), hidden: !canWrite || !active },
      { key: 'revalue', label: t('menu.revalue'), onSelect: () => setOpen({ kind: 'revalue', row }), hidden: !canWrite || !active },
      { key: 'end', label: t('menu.end'), onSelect: () => setOpen({ kind: 'end', row }), hidden: !canWrite || !active },
      { key: 'view', label: t('menu.view'), onSelect: () => setOpen({ kind: 'view', row }), hidden: !canWrite || active },
      { key: 'document', label: t('menu.document'), href: row.documentId ? `/dms/${row.documentId}` : undefined, hidden: !row.documentId },
    ];
  };
  // Der Name öffnet den Eintrag: zum Bearbeiten, wer darf und solange er gilt, sonst zum Ansehen.
  const openRow = (row: OtherAssetRow) => setOpen({ kind: canWrite && row.recordedUntil === null ? 'edit' : 'view', row });

  const create = canWrite ? (
    <Button type="button" onClick={() => setOpen({ kind: 'create' })} data-testid="other-assets-create">
      {t('create')}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t('title')} description={t('intro')} actions={create} />
      {!hasAny ? (
        <EmptyState title={t('empty.title')} text={t('empty.text')} action={create ?? undefined} />
      ) : (
        <div className="space-y-4">
          <FilterBar filters={[dateSlot]} count={{ shown: rows.length, total: rows.length, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }} onReset={() => undefined} testId="other-assets-date-bar" />
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.label')}</TableHead>
                  {/* Feste Breiten, gleich in „Beendet“ (250/255): die Spalten springen nicht. */}
                  <TableHead col="meta" className="w-56">{t('columns.since')}</TableHead>
                  <TableHead col="amount" className="w-36 text-right">{t('columns.value')}</TableHead>
                  <TableHead col="actions" className="w-11"><span className="sr-only">{t('columns.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? <TableEmpty colSpan={4}>{t('noneAtDate', { date: fmt.date(date) })}</TableEmpty> : null}
                {KINDS.map((kind) => {
                  const inKind = rows.filter((r) => r.kind === kind);
                  if (inKind.length === 0) return null;
                  return [
                    <TableGroupRow key={kind} colSpan={4} testId="other-asset-group">
                      {/* Die Summe an der rechten Kante der Werte, nicht unter ⋯ (250): Die Aktionsspalte ist so breit wie ihr
                          Knopf (`size="icon"`, Feldhöhe) plus 2 × 16 px Polster — `w-11` am Kopf ist kleiner und greift nicht
                          (Designer Runde 8, 257/262: 20 px zu weit rechts). Kein Layout-Test (Pixelmaß). */}
                      <span className="flex items-baseline justify-between gap-3 pr-[calc(var(--field-h)+2rem)]">
                        <span>{t(`groups.${kind}`)}</span>
                        <span className="tabular-nums">{formatEuro(inKind.reduce((sum, r) => sum + r.valueCents, 0))}</span>
                      </span>
                    </TableGroupRow>,
                    ...inKind.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell col="title">
                          <RowButton type="button" aria-haspopup="dialog" onClick={() => openRow(row)}>
                            {row.label}
                          </RowButton>
                          <span className="block text-meta text-muted-ink">{row.basis}</span>
                        </TableCell>
                        <TableCell col="meta">{fmt.date(row.recordedFrom)}</TableCell>
                        <TableCell col="amount" className="text-right tabular-nums" selectable>
                          {formatEuro(row.valueCents)}
                        </TableCell>
                        <TableCell col="actions">
                          <RowMenu name={row.label} items={menu(row)} />
                        </TableCell>
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
          {ended.length > 0 ? (
            <Disclosure label={t('ended')} count={ended.length}>
              <div className="overflow-hidden rounded-md border border-line bg-surface">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead col="title">{t('columns.label')}</TableHead>
                      <TableHead col="meta" className="w-56">{t('columns.period')}</TableHead>
                      <TableHead col="amount" className="w-36 text-right">{t('columns.value')}</TableHead>
                      <TableHead col="actions" className="w-11"><span className="sr-only">{t('columns.actions')}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ended.map((row) => (
                      <TableRow key={row.id} muted={tMuted('ended')}>
                        <TableCell col="title" mutedMark="inline">
                          <RowButton type="button" aria-haspopup="dialog" onClick={() => setOpen({ kind: 'view', row })}>
                            {row.label}
                          </RowButton>
                          <MutedMark />
                          {row.endReason ? <span className="block text-meta text-muted-ink">{row.endReason}</span> : null}
                        </TableCell>
                        <TableCell col="meta" wrap>
                          {t('periodRange', { from: fmt.date(row.recordedFrom), to: fmt.date(row.recordedUntil!) })}
                        </TableCell>
                        <TableCell col="amount" className="text-right tabular-nums">
                          {formatEuro(row.valueCents)}
                        </TableCell>
                        <TableCell col="actions">
                          <RowMenu name={row.label} items={[{ key: 'view', label: t('menu.view'), onSelect: () => setOpen({ kind: 'view', row }) }, { key: 'document', label: t('menu.document'), href: row.documentId ? `/dms/${row.documentId}` : undefined, hidden: !row.documentId }]} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Disclosure>
          ) : null}
        </div>
      )}
      {canWrite ? <OtherAssetDialog open={open?.kind === 'create' || open?.kind === 'edit'} onOpenChange={(next) => (next ? undefined : setOpen(null))} entry={open?.kind === 'edit' ? open.row : null} today={today} /> : null}
      {open?.kind === 'revalue' ? <RevalueDialog entry={open.row} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'end' ? <EndDialog entry={open.row} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'view' ? <ViewDialog entry={open.row} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** „Ansehen“ eines beendeten Eintrags: die Werte als Text. Kein Hauptknopf — nur „Schließen“, darum `DialogFooter`. */
function ViewDialog({ entry, onClose }: { entry: OtherAssetRow; onClose: () => void }) {
  const t = useTranslations('finance.otherAssets');
  const c = useTranslations('common');
  const fmt = useDateFormat();
  const rows: [string, string][] = [
    [t('dialog.kind'), t(`dialog.kinds.${entry.kind}`)],
    [t('dialog.value'), formatEuro(entry.valueCents)],
    [t('view.period'), entry.recordedUntil ? t('periodRange', { from: fmt.date(entry.recordedFrom), to: fmt.date(entry.recordedUntil) }) : fmt.date(entry.recordedFrom)],
    [t('dialog.basis'), entry.basis],
    ...(entry.recordedUntil ? ([[t('view.reason'), entry.endReason ?? t('view.reasonNone')]] as [string, string][]) : []),
  ];
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="other-asset-view">
        <DialogHeader>
          <DialogTitle>{entry.label}</DialogTitle>
          {entry.recordedUntil ? <DialogDescription tone="meta">{t('view.fixed')}</DialogDescription> : null}
        </DialogHeader>
        <dl className="flex flex-col gap-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <Overline as="dt" field>
                {label}
              </Overline>
              <dd className="text-body text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {c('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
