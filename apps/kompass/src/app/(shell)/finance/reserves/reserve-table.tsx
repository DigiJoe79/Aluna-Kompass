'use client';

import { Info, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import type { ReserveKind } from '@/lib/finance/reserves';
import { deleteReserveAction, setReserveActiveAction } from './actions';
import { CarryForwardDialog } from './carry-forward-dialog';
import { MovementDialog, type MovementReserve } from './movement-dialog';
import { ReplaceResolutionDialog } from './replace-resolution-dialog';
import { ReserveForm } from './reserve-form';
import { Empty } from '@/components/empty-value';

/** Ein Beschluss, wie die Akte ihn dieser Person zeigt — oder nur „hinterlegt“. */
export type ReserveDocument = { id: string; number: string; subject: string; date: string | null } | { id: string; hidden: true };

export interface ReserveRow extends MovementReserve {
  kind: ReserveKind;
  purposeId: string | null;
  purposeText: string | null;
  purposeLabel: string | null;
  resolution: ReserveDocument | null;
  carryForwardCents: number | null;
  carryForwardDate: string | null;
  carryForwardDocument: ReserveDocument | null;
  isActive: boolean;
  isDissolved: boolean;
  updatedAt: string;
}

/** § 62 AO als Infoknopf (Designer-README 4d): per Tastatur und Tippen, nicht als `title`. Escape schließt. */
function KindInfo({ kind }: { kind: ReserveKind }) {
  const t = useTranslations('finance.reserves');
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="inline-flex flex-col items-start"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {t(`kinds.${kind}`)}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-controls={id}
          aria-label={t('kindInfo', { kind: t(`kinds.${kind}`) })}
          data-testid="reserve-kind-info"
          onClick={() => setOpen((v) => !v)}
        >
          <Info className="size-3.5" aria-hidden />
        </Button>
      </span>
      <span id={id} hidden={!open} className="text-hint text-muted-ink">
        {t(`kindHints.${kind}`)}
      </span>
    </span>
  );
}

/** „A-2026-0090 · Betreff · 12.02.2026“ (Designer-README 4d) statt „Beschluss öffnen“. */
/** `subject={false}`: nur Nummer und Datum — in der Tabelle (09 B38); die Dialoge nennen den Betreff. */
export function DocumentLabel({ document, testId, subject = true }: { document: ReserveDocument | null; testId?: string; subject?: boolean }) {
  const t = useTranslations('finance.reserves');
  const fmt = useDateFormat();
  if (!document) return <span data-testid={testId}><Empty /></span>;
  if ('hidden' in document) {
    return (
      <span className="text-meta text-ink-2" data-testid={testId}>
        {t('resolutionHidden')}
      </span>
    );
  }
  return (
    <a href={`/dms/${document.id}`} className="text-meta underline-offset-2 hover:underline" data-testid={testId}>
      <span className="font-mono">{document.number}</span>
      {subject && document.subject ? ` · ${document.subject}` : ''}
      {document.date ? ` · ${fmt.date(document.date)}` : ''}
    </a>
  );
}

type Open = { kind: 'movement' | 'edit' | 'carryForward' | 'resolution' | 'delete'; row: ReserveRow } | { kind: 'create' } | null;

/**
 * E4 Tabelle (Designer-README 4d): Art in Alltagssprache mit § 62 AO im
 * Infoknopf · Bezeichnung · Zweck · Beschluss mit Nummer, Betreff und Datum ·
 * Bestand · „Vorgang“, dazu das Zeilenmenü für den Stammsatz (Befund 40):
 * Bearbeiten · Beschluss ersetzen · Vortrag erfassen · stilllegen/löschen —
 * derselbe Weg wie `finance_reserve_save`, `_resolution_link`,
 * `_set_active` und `_delete`.
 */
export function ReserveTable({
  rows,
  purposes,
  fiscalYears,
  defaultFiscalYearId,
  today,
  canWrite,
  canSetup,
}: {
  rows: ReserveRow[];
  purposes: { id: string; name: string }[];
  fiscalYears: { id: string; designation: string }[];
  defaultFiscalYearId: string | null;
  today: string;
  canWrite: boolean;
  canSetup: boolean;
}) {
  const t = useTranslations('finance.reserves');
  const fmt = useDateFormat();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  // „Stilllegen“ steht im Zeilenmenü: Die Ablehnung steht über der Tabelle.
  const activeFb = useActionFeedback();
  const close = () => setOpen(null);
  const saved = (message: string) => () => {
    setOpen(null);
    toast.success(message);
    router.refresh();
  };

  const toggleActive = async (row: ReserveRow) => {
    const result = await activeFb.run(() => setReserveActiveAction(row.id, !row.isActive, row.updatedAt), { retry: () => void toggleActive(row) });
    if (result.status !== 'success') return;
    toast.success(row.isActive ? t('menu.deactivated') : t('menu.activated'));
    router.refresh();
  };

  const menu = (row: ReserveRow) => {
    if (!canSetup && !canWrite) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={t('menu.label', { name: row.name })} data-testid="reserve-menu">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto bg-surface shadow-md">
          {canSetup ? <DropdownMenuItem onSelect={() => setOpen({ kind: 'edit', row })}>{t('menu.edit')}</DropdownMenuItem> : null}
          {canWrite ? <DropdownMenuItem onSelect={() => setOpen({ kind: 'resolution', row })}>{t('menu.replaceResolution')}</DropdownMenuItem> : null}
          {canSetup ? <DropdownMenuItem onSelect={() => setOpen({ kind: 'carryForward', row })}>{t('menu.carryForward')}</DropdownMenuItem> : null}
          {canSetup ? <DropdownMenuItem onSelect={() => void toggleActive(row)}>{row.isActive ? t('menu.deactivate') : t('menu.activate')}</DropdownMenuItem> : null}
          {canSetup ? <DropdownMenuItem onSelect={() => setOpen({ kind: 'delete', row })}>{t('menu.delete')}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="space-y-3">
      <RefusalNotice action state={activeFb.state} />
      {canSetup ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setOpen({ kind: 'create' })} data-testid="reserve-create">
            {t('create')}
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-md border border-line bg-surface p-4 text-body text-ink-2">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <Table data-testid="reserve-table">
            <TableHeader>
              <TableRow>
                <TableHead col="meta" className="px-3">{t('columns.kind')}</TableHead>
                <TableHead col="title" className="px-3">{t('columns.name')}</TableHead>
                <TableHead col="meta" className="px-3">{t('columns.purpose')}</TableHead>
                <TableHead col="meta" className="px-3">{t('columns.resolution')}</TableHead>
                <TableHead col="amount" className="px-3 text-right">{t('columns.balance')}</TableHead>
                <TableHead col="actions" className="px-3 text-right">{t('columns.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="reserve-row">
                  <TableCell col="meta" className="px-3 align-top text-ink">
                    <KindInfo kind={row.kind} />
                  </TableCell>
                  <TableCell col="title" className="px-3 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink">{row.name}</span>
                      {row.isActive ? null : <StatusBadge tone="neutral">{t('inactive')}</StatusBadge>}
                      {/* 09 B39: „aufgelöst“ ist ein Zustand am Namen, nicht an der Stelle des Knopfes. */}
                      {row.isDissolved ? <StatusBadge tone="neutral">{t('dissolved')}</StatusBadge> : null}
                    </div>
                    {row.carryForwardCents !== null && row.carryForwardDate ? (
                      <p className="text-hint text-muted-ink">{t('carryForwardLine', { amount: formatEuro(row.carryForwardCents), date: fmt.date(row.carryForwardDate) })}</p>
                    ) : null}
                  </TableCell>
                  <TableCell col="meta" className="px-3 align-top text-ink-2">{row.purposeLabel ?? <Empty />}</TableCell>
                  {/* Nummer · Datum (09 B38) darf umbrechen: mit Betreff trieb der Betreff die Tabelle auf einer standard-Seite ins waagerechte Scrollen (K9-Befund 8). */}
                  <TableCell col="meta" className="whitespace-normal px-3 align-top">
                    <DocumentLabel document={row.resolution} testId="reserve-resolution" subject={false} />
                  </TableCell>
                  <TableCell col="amount" className="px-3 text-right align-top font-semibold tabular-nums" data-testid="reserve-balance">
                    {formatEuro(row.balanceCents)}
                  </TableCell>
                  <TableCell col="actions" className="px-3 text-right align-top">
                    <div className="flex items-center justify-end gap-1">
                      {!row.isDissolved && canWrite && row.isActive ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setOpen({ kind: 'movement', row })} data-testid="reserve-movement-trigger">
                          {t('movementTrigger')}
                        </Button>
                      ) : null}
                      {menu(row)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open?.kind === 'movement' ? (
        <MovementDialog reserve={open.row} today={today} fiscalYears={fiscalYears} defaultFiscalYearId={defaultFiscalYearId} onClose={close} onSaved={saved(t('movement.saved'))} />
      ) : null}
      {open?.kind === 'create' ? <ReserveForm purposes={purposes} onClose={close} onSaved={saved(t('form.saved'))} /> : null}
      {open?.kind === 'edit' ? <ReserveForm purposes={purposes} initial={open.row} onClose={close} onSaved={saved(t('form.updated'))} /> : null}
      {open?.kind === 'carryForward' ? <CarryForwardDialog reserve={open.row} onClose={close} onSaved={saved(t('carryForward.saved'))} /> : null}
      {open?.kind === 'resolution' ? <ReplaceResolutionDialog reserve={open.row} onClose={close} onSaved={saved(t('replaceResolution.saved'))} /> : null}
      {open?.kind === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t('deleteDialog.title', { name: open.row.name })}
          description={t('deleteDialog.description')}
          confirmLabel={t('deleteDialog.confirm')}
          destructive
          action={async () => {
            const result = await deleteReserveAction(open.row.id);
            if (result.status !== 'success') return result;
            router.refresh();
            return { status: 'success', message: t('deleteDialog.deleted') };
          }}
        />
      ) : null}
    </div>
  );
}
