'use client';

import { ArrowLeftRight, Banknote, FileCheck2, Link2, ListChecks, Undo2, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SuggestionReason } from '@kompass/module-finance';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountCell } from '@/components/finance/amount-cell';
import { EntryStateBadge } from '@/components/finance/entry-state-badge';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { EmptyState } from '@/components/empty-state';
import { KeyChip } from '@/components/key-chip';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { afterRemoval, stepSelection, workHref, type WorkTabKey } from '@/lib/finance/work';
import { cn } from '@/lib/utils';
import { deleteWorkDraftAction, markReviewedAction } from './actions';
import { WorkDetail, type WorkDetailData, type WorkFormOptions } from './work-detail';

export interface WorkTransactionRow {
  id: string;
  bookingDate: string;
  counterpartyName: string | null;
  purpose: string;
  amountCents: number;
  accountName: string;
  /** offen · vorgeschlagen (ein Entwurf bindet ihn) · gebucht. */
  state: 'open' | 'proposed' | 'booked';
  /** Woher der Vorschlag kommt — das Symbol in der Zeile. */
  origin: SuggestionReason['kind'] | null;
  unsure: boolean;
}

/** Herkunft eines Vorschlags → Symbolgruppe; die Gruppe hat ein Symbol und einen Namen für die Legende (07-1 B12). */
const ORIGIN_GROUP = {
  linkEntry: 'link',
  cashTransferEntry: 'link',
  pair: 'pair',
  cashKeyword: 'cash',
  returnCode: 'return',
  directDebitReturn: 'return',
  relatedReference: 'return',
  paymentReference: 'openItem',
  amountAndContact: 'openItem',
  directDebitRun: 'openItem',
  rule: 'rule',
  contactIban: 'contact',
  contactEmail: 'contact',
  contactName: 'contact',
  sharedIban: 'contact',
  paymentFee: 'rule',
  directDebitReturnFee: 'return',
} as const;

const GROUP_ICON = {
  link: Link2,
  pair: ArrowLeftRight,
  cash: Banknote,
  return: Undo2,
  openItem: FileCheck2,
  rule: ListChecks,
  contact: UserRound,
} as const;

type OriginGroup = keyof typeof GROUP_ICON;

/** Tasten, die nur wirken, wenn gerade nichts anderes sie braucht: kein Eingabefeld, kein Knopf, kein Dialog. */
function keyBelongsToPage(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  if (target.isContentEditable) return false;
  if (target.closest('input, textarea, select, button, a, [role="dialog"], [role="alertdialog"], [role="menu"], [role="combobox"]')) return false;
  return true;
}

/**
 * Die Umsätze der Reiter „Zuzuordnen“ und „Unsicher“ mit dem gewählten rechts
 * (HANDOFF § 12.5). Die Auswahl steht in der Adresse (`?raw=`), damit der
 * Server den Vorschlag dazu liefert. Tasten (`↑↓ Enter E →`) nur mit
 * `finance.entriesWrite` und nie, solange ein Eingabefeld den Fokus hat.
 */
export function WorkTransactions({
  rows,
  selectedId,
  tab,
  account,
  page,
  canWrite,
  waitingCount,
  detail,
  form,
  footer,
}: {
  rows: WorkTransactionRow[];
  selectedId: string | null;
  tab: WorkTabKey;
  account: string | null;
  /** Die Seite der Liste (`ListPager`) — eine Auswahl bleibt auf ihr. */
  page: number;
  canWrite: boolean;
  waitingCount: number;
  /** Fuß der Listenkarte: `ListPager footer` (Designer 2026-10-08). */
  footer?: ReactNode;
  detail: WorkDetailData | null;
  form: WorkFormOptions;
}) {
  const t = useTranslations('finance.work');
  const { date } = useDateFormat();
  const router = useRouter();
  const [selected, setSelected] = useState(selectedId);
  const [announce, setAnnounce] = useState(false);
  const acceptRef = useRef<(() => void) | null>(null);
  const ids = rows.map((r) => r.id);

  // Der Server hat eine neue Auswahl geliefert (Neuladen, nach dem Übernehmen) — sie gilt.
  useEffect(() => setSelected(selectedId), [selectedId]);

  const select = (id: string | null) => {
    if (id === null || id === selected) return;
    setSelected(id);
    router.replace(workHref({ tab, account, raw: id, page }), { scroll: false });
  };

  const onDone = (removedId: string) => {
    setAnnounce(true);
    const next = afterRemoval(ids, removedId);
    setSelected(next);
    router.replace(workHref({ tab, account, raw: next, page }), { scroll: false });
  };

  useEffect(() => {
    if (!canWrite) return;
    const onKey = (event: KeyboardEvent) => {
      if (!keyBelongsToPage(event)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        select(stepSelection(ids, selected, event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        select(stepSelection(ids, selected, 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        acceptRef.current?.();
      } else if ((event.key === 'e' || event.key === 'E') && selected) {
        event.preventDefault();
        router.push(`/finance/entries/new?raw=${selected}&back=work`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shownDetail = detail && detail.raw.id === selected ? detail : null;
  const legend = [...new Set(rows.flatMap((row) => (row.origin ? [ORIGIN_GROUP[row.origin]] : [])))].sort() as OriginGroup[];

  return (
    // 07-1 B18: Liste und Vorschlag nebeneinander nach der Breite des Inhalts, nicht des Fensters — bei 1024 px mit
  // Seitenleiste rutschte der Vorschlag sonst unter die Liste (ohne Layout-Test, Projektregel).
  <div className="@container">
  <div className="flex flex-col gap-4 @min-[48rem]:flex-row @min-[48rem]:items-start">
      <div className="min-w-0 flex-1 rounded-md border border-line bg-surface">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('list.empty')} text={t('list.emptyText')} />
          </div>
        ) : (
          <div id="work-listbox" role="listbox" aria-label={t('list.label')} tabIndex={0} className="max-h-[60vh] divide-y divide-line-2 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {rows.map((row) => {
              const Icon = row.origin ? GROUP_ICON[ORIGIN_GROUP[row.origin]] : null;
              const isSelected = row.id === selected;
              return (
                <div
                  key={row.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(row.id)}
                  className={cn('flex cursor-pointer items-start gap-3 border-l-4 px-3 py-2.5 text-meta', isSelected ? 'border-l-brand bg-selected/40' : 'border-l-transparent hover:bg-row-hover')}
                >
                  {/* Runde 3, 064 (E1): Am Telefon steht das Datum in der Unterzeile und das Symbol am Namen, damit der Name
                      die Breite hat. Layout an einer Stelle, ohne dauerhaften Test (Projektregel). */}
                  <span className="w-[84px] shrink-0 text-hint tabular-nums text-ink-2 max-sm:hidden">{date(row.bookingDate)}</span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{row.counterpartyName ?? row.purpose}</span>
                      {Icon && row.origin ? (
                        <span className="shrink-0 text-agent sm:hidden" title={t(`origin.${row.origin}`)}>
                          <Icon className="size-4" aria-hidden />
                          <span className="sr-only">{t(`origin.${row.origin}`)}</span>
                        </span>
                      ) : null}
                      {/* 07-1 B11: Die Reiter „Zuzuordnen“ und „Unsicher“ zeigen offene Umsätze — „offen“ steht nur, wo es abweicht. */}
                      {row.state === 'open' ? null : <StatusBadge tone={statusTone('workRow', row.state)}>{t(`rowState.${row.state}`)}</StatusBadge>}
                      {row.unsure && tab === 'open' ? <StatusBadge tone="warning">{t('suggestion.unsure')}</StatusBadge> : null}
                    </span>
                    <span className="block truncate text-ink-2" title={row.purpose}>
                      <span className="tabular-nums sm:hidden">{date(row.bookingDate)} · </span>
                      {row.purpose} · {row.accountName}
                    </span>
                  </span>
                  {Icon && row.origin ? (
                    <span className="mt-0.5 shrink-0 text-agent max-sm:hidden" title={t(`origin.${row.origin}`)}>
                      <Icon className="size-4" aria-hidden />
                      <span className="sr-only">{t(`origin.${row.origin}`)}</span>
                    </span>
                  ) : null}
                  <span className="w-28 shrink-0 max-sm:w-auto">
                    <AmountCell cents={row.amountCents} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p data-testid="work-live" aria-live="polite" className="px-3 py-1 text-hint text-ink-2 empty:hidden">
          {announce ? t('live.waiting', { count: waitingCount }) : ''}
        </p>
        {footer}
        {/* Die Liste scrollt in sich; die Tastenkürzel stehen darunter und bleiben so immer sichtbar (HANDOFF § 12.6). */}
        {rows.length > 0 && (canWrite || legend.length > 0) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2 px-3 py-2 text-hint text-ink-2">
            {/* 07-1 B12: Legende der Symbole, nur die in der Liste vorkommen. */}
            {legend.map((group) => {
              const GroupIcon = GROUP_ICON[group];
              return (
                <span key={group} data-testid="work-legend" className="flex items-center gap-1">
                  <GroupIcon className="size-3.5 text-agent" aria-hidden />
                  {t(`legend.${group}`)}
                </span>
              );
            })}
            {/* 07-1 B17: Am Telefon gibt es keine Tastatur — die Kürzel stehen dort nicht. */}
            {canWrite ? (
            <span data-testid="work-keys" role="group" aria-label={t('keys.label')} className="contents max-sm:hidden pointer-coarse:hidden">
            <span className="flex items-center gap-1">
              <KeyChip label={t('keys.up')}>↑</KeyChip>
              <KeyChip label={t('keys.down')}>↓</KeyChip>
              {t('keys.move')}
            </span>
            <span className="flex items-center gap-1">
              <KeyChip>{t('keys.enterKey')}</KeyChip>
              {t('keys.accept')}
            </span>
            <span className="flex items-center gap-1">
              <KeyChip>E</KeyChip>
              {t('keys.edit')}
            </span>
            <span className="flex items-center gap-1">
              <KeyChip label={t('keys.right')}>→</KeyChip>
              {t('keys.skip')}
            </span>
            </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <WorkDetail
          detail={shownDetail}
          canWrite={canWrite}
          form={form}
          acceptRef={acceptRef}
          onDone={onDone}
          onSkip={() => select(stepSelection(ids, selected, 1))}
          onReload={() => router.refresh()}
        />
      ) : null}
    </div>
    </div>
  );
}

export interface WorkEntryRow {
  id: string;
  number: string | null;
  entryDate: string;
  text: string;
  totalCents: number;
  reviewedAt: string | null;
  createdChannel: string;
  accountNames: string;
}

/** Reiter „Vom Agenten vorbereitet“ und „Geprüft, nicht festgeschrieben“: Entwürfe, keine Umsätze (Annahme 11). */
export function WorkEntries({ rows, tab, canWrite, footer }: { rows: WorkEntryRow[]; tab: 'agent' | 'reviewed'; canWrite: boolean; footer?: ReactNode }) {
  const te = useTranslations('finance.work');
  const { date } = useDateFormat();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<WorkEntryRow | null>(null);
  // „Als geprüft“ steht in den Zeilen: Die Ablehnung steht über der Liste.
  const reviewFb = useActionFeedback();

  if (rows.length === 0) return <EmptyState title={te('entries.empty')} text={te('list.emptyText')} />;

  const review = (id: string) =>
    startTransition(async () => {
      const result = await reviewFb.run(() => markReviewedAction(id), { retry: () => review(id) });
      if (result.status === 'success') router.refresh();
    });

  return (
    <>
    <RefusalNotice action state={reviewFb.state} />
    <section aria-label={te('entries.label')} className="divide-y divide-line-2 rounded-md border border-line bg-surface">
      {rows.map((row) => (
        <div key={row.id} data-testid="work-entry" className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-meta">
          <span className="w-[84px] shrink-0 text-hint tabular-nums text-ink-2">{date(row.entryDate)}</span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{row.text}</span>
              <EntryStateBadge entry={{ status: 'draft', reviewedAt: row.reviewedAt, reversedByEntryId: null, createdChannel: row.createdChannel }} />
            </span>
            <span className="block truncate text-ink-2">{row.accountNames}</span>
          </span>
          <span className="w-28 shrink-0">
            <AmountCell cents={row.totalCents} />
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {/* Befund 42: Ein Entwurf öffnet direkt in der Maske — die Ansicht leitete ihn serverseitig um, zwei Sprünge statt einem. */}
            <Link href={`/finance/entries/${row.id}/edit`} className="text-meta font-semibold underline underline-offset-2">
              {te('entries.view')}
            </Link>
            {canWrite && tab === 'agent' ? (
              <Button type="button" size="sm" onClick={() => review(row.id)}>
                {te('entries.review')}
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(row)}>
                {te('entries.delete')}
              </Button>
            ) : null}
          </span>
        </div>
      ))}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={te('entries.deleteTitle')}
        description={te('entries.deleteText')}
        confirmLabel={te('entries.delete')}
        destructive
        action={async () => {
          const result = await deleteWorkDraftAction(deleting!.id);
          if (result.status === 'success') {
            if (result.message) toast.success(result.message);
            setDeleting(null);
            router.refresh();
          }
          return result;
        }}
      />
      {footer}
    </section>
    </>
  );
}

export interface WorkOpenItemRow {
  id: string;
  kind: 'receivable' | 'payable';
  dueOn: string | null;
  openCents: number;
  paymentReference: string | null;
  contactName: string | null;
}

/** Reiter „Fällig“: überfällige offene Zahlungen beider Richtungen, je mit dem Weg zur offenen Zahlung (Annahme 12). */
export function WorkOpenItems({ rows, footer }: { rows: WorkOpenItemRow[]; footer?: ReactNode }) {
  const td = useTranslations('finance.work');
  const { date } = useDateFormat();
  if (rows.length === 0) return <EmptyState title={td('due.empty')} text={td('list.emptyText')} />;
  return (
    <section aria-label={td('due.label')} className="divide-y divide-line-2 rounded-md border border-line bg-surface">
      {rows.map((row) => (
        <div key={row.id} data-testid="work-open-item" className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-meta">
          <span className="w-[120px] shrink-0 text-hint tabular-nums text-ink-2">{row.dueOn ? td('due.dueOn', { date: date(row.dueOn) }) : ''}</span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{row.paymentReference ?? td('due.noReference')}</span>
              <StatusBadge tone="error">{td(`due.${row.kind}`)}</StatusBadge>
            </span>
            {row.contactName ? <span className="block truncate text-ink-2">{row.contactName}</span> : null}
          </span>
          <span className="w-28 shrink-0 text-right tabular-nums">{formatEuro(row.openCents)}</span>
          <Link href={`/finance/open-items?tab=${row.kind}&item=${row.id}`} className="text-meta font-semibold underline underline-offset-2">
            {td('due.open')}
          </Link>
        </div>
      ))}
      {footer}
    </section>
  );
}
