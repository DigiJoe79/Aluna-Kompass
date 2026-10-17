'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import type { ReserveKind } from '@/lib/finance/reserves';
import { deleteReserveAction, setReserveActiveAction } from './actions';
import { CarryForwardDialog } from './carry-forward-dialog';
import { MovementDialog, type MovementReserve } from './movement-dialog';
import { ReplaceResolutionDialog } from './replace-resolution-dialog';
import { ReserveForm } from './reserve-form';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

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

/**
 * Infoknopf (Designer-README 4d): ein kleiner Knopf neben dem Wort, der einen Satz darunter auf- und zuklappt — per
 * Tastatur und Tippen, nicht als `title`. Escape schließt. Für die Rechtsgrundlage der Art und die Rechnung des
 * Höchstbetrags (Runde 3, 123).
 */
function InfoDisclosure({ children, ariaLabel, text, testId }: { children: ReactNode; ariaLabel: string; text: string; testId: string }) {
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
        {children}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-controls={id}
          aria-label={ariaLabel}
          data-testid={testId}
          onClick={() => setOpen((v) => !v)}
        >
          <Info className="size-3.5" aria-hidden />
        </Button>
      </span>
      <span id={id} hidden={!open} className="text-hint text-muted-ink">
        {text}
      </span>
    </span>
  );
}

/** § 62 AO zur Art. */
function KindInfo({ kind }: { kind: ReserveKind }) {
  const t = useTranslations('finance.reserves');
  return (
    <InfoDisclosure ariaLabel={t('kindInfo', { kind: t(`kinds.${kind}`) })} text={t(`kindHints.${kind}`)} testId="reserve-kind-info">
      {t(`kinds.${kind}`)}
    </InfoDisclosure>
  );
}

/**
 * Unter dem Höchstbetrag der freien Rücklage die kurze Zeile; die Rechnung mit den Zahlen des Jahres steht hinter dem
 * Infoknopf (Runde 3, 123, Joe: als Schatzmeister braucht man die Zahlen).
 */
export function CapDerivation({ year, derivation }: { year: string; derivation: string }) {
  const t = useTranslations('finance.reserves');
  return (
    <div className="mt-1.5 text-hint text-muted-ink">
      <InfoDisclosure ariaLabel={t('cap.derivationInfo', { year })} text={derivation} testId="reserve-cap-derivation">
        {t('cap.approximation')}
      </InfoDisclosure>
    </div>
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

type Open = { kind: 'movement' | 'edit' | 'carryForward' | 'resolution' | 'delete'; row: ReserveRow } | null;

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

  // Zeilenaktionen im ⋯-Menü (Joe 11.8), auch „Vorgang …“ (123); die Spalte trägt keinen sichtbaren Kopf (112).
  const menu = (row: ReserveRow) => {
    if (!canSetup && !canWrite) return null;
    return (
      <RowMenu
        name={row.name}
        testId="reserve-menu"
        items={[
          { key: 'movement', label: t('movementTrigger'), hidden: !(!row.isDissolved && canWrite && row.isActive), onSelect: () => setOpen({ kind: 'movement', row }), testId: 'reserve-movement-trigger' },
          { key: 'edit', label: t('menu.edit'), hidden: !canSetup, onSelect: () => setOpen({ kind: 'edit', row }) },
          { key: 'resolution', label: t('menu.replaceResolution'), hidden: !canWrite, onSelect: () => setOpen({ kind: 'resolution', row }) },
          { key: 'carryForward', label: t('menu.carryForward'), hidden: !canSetup, onSelect: () => setOpen({ kind: 'carryForward', row }) },
          { key: 'active', label: row.isActive ? t('menu.deactivate') : t('menu.activate'), hidden: !canSetup, onSelect: () => void toggleActive(row) },
          { key: 'delete', label: t('menu.delete'), kind: 'delete', hidden: !canSetup, onSelect: () => setOpen({ kind: 'delete', row }) },
        ]}
      />
    );
  };

  return (
    <div className="space-y-3">
      <RefusalNotice action state={activeFb.state} />
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
                <TableHead col="actions" className="w-11 px-3"><span className="sr-only">{t('columns.action')}</span></TableHead>
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
                    {menu(row)}
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

/** „Geld zurücklegen“ als Primärknopf im Seitenkopf wie auf jeder Liste, nicht über der Tabelle (Runde 3, 123). */
export function CreateReserveButton({ purposes }: { purposes: { id: string; name: string }[] }) {
  const t = useTranslations('finance.reserves');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="reserve-create">
        {t('create')}
      </Button>
      {open ? (
        <ReserveForm
          purposes={purposes}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            toast.success(t('form.saved'));
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
