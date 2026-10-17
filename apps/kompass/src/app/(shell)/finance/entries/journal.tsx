'use client';

import { FileCheck2, FileStack, FileSymlink, FileWarning, FileX2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, type ReactNode, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { Standing } from '@kompass/module-finance';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { ListPager } from '@/components/list-pager';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { AmountCell } from '@/components/finance/amount-cell';
import { EntryStateBadge } from '@/components/finance/entry-state-badge';
import { PageHeader } from '@/components/page-header';
import { SelectionBar } from '@/components/selection-bar';
import { SortableHead } from '@/components/sortable-head';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RowLink, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';
import { deleteDraftsAction, finalizeAllReviewedAction, finalizeReviewedAction, setReviewedManyAction } from './actions';
import { JournalFilters } from './filters';
import { panelHref } from '@/components/panel-nav';
import { EMPTY, Empty } from '@/components/empty-value';

/** Spalte „Konto“: weg mit offener Hilfe (`#help-panel`) und von md bis lg, am Telefon in der Kartenzeile. */
// Zehn Spalten brauchen rund 1250 px (Text mindestens 14rem, Wofür und Spender an Wortgrenzen umbrochen). Ist die Liste
// schmaler — 1440 px Fenster mit Bereichsnavigation, Bestände daneben ab 1680 px —, weichen zuerst Konto und Beleg, wie
// mit offener Hilfe; Wofür und Spender/Empfänger bleiben (Runde 4, 086; Joe 11.5). Ohne Layout-Test (Einzelstelle).
const TIGHT_HIDE = '@max-[80rem]/journal:hidden';
const ACCOUNT_COLUMN_HIDE = `md:max-lg:hidden [body:has(#help-panel)_&]:hidden ${TIGHT_HIDE}`;
/** Das Gegenstück: das Konto als Unterzeile unter dem Text, genau dann, wenn die Spalte fehlt — nicht am Telefon, dort
 * steht es in der Kartenzeile (Runde 4, Frage 2). */
const ACCOUNT_SUBLINE_SHOW = 'hidden md:max-lg:block md:[body:has(#help-panel)_&]:block md:@max-[80rem]/journal:block';
/** Dasselbe hinter einem Verweis in dessen Zeile: „nimmt zurück: 2026-0008 · Vereinskonto“ (Runde 4 Nachtrag, 213). */
const ACCOUNT_INLINE_SHOW = 'hidden md:max-lg:inline md:[body:has(#help-panel)_&]:inline md:@max-[80rem]/journal:inline';

export interface JournalRow {
  id: string;
  number: string | null;
  entryDate: string;
  text: string;
  accountLabel: string;
  allocationLabel: string;
  contactLabel: string | null;
  amountCents: number;
  /** Befund 21: eine Umbuchung zwischen eigenen Konten ohne Kontofilter — der Betrag ist die Bewegung, kein Vorzeichen einer Summe. */
  transfer: boolean;
  /** Befund 23: laufender Saldo auf dem gefilterten Konto — `null` ohne Kontofilter oder an einem Entwurf. */
  runningBalanceCents: number | null;
  documentationState: 'voucher' | 'statementSuffices' | 'notApplicable' | 'missing' | 'onOrigin';
  status: 'draft' | 'final';
  reviewedAt: string | null;
  reversedByEntryId: string | null;
  reversedByNumber: string | null;
  reversesEntryId: string | null;
  reversesNumber: string | null;
  correctionOfEntryId: string | null;
  correctionOfNumber: string | null;
  createdChannel: string;
}

export interface JournalProps {
  rows: JournalRow[];
  total: number;
  totals: { incomeCents: number; expenseCents: number; resultCents: number };
  page: number;
  pageSize: number;
  standing: Standing;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** Geschäftsjahre für den Filter „Jahr“. */
  years: { id: string; label: string }[];
  /** Buchungen ohne jeden Filter — das „von …“ der Zählzeile. */
  unfiltered: number;
  canWrite: boolean;
  canFinalize: boolean;
  /** Zweiter Knopf im leeren Journal (Task 3): nur solange ein Konto ohne Anfangsbestand existiert und der Betrachter `finance.setup` hat. */
  showSetupLink: boolean;
  /** Irgendein Filter der Leiste gesetzt (auch `year` und `ids` aus Links): Ohne Treffer heißt das „gefiltert leer“, nicht „noch keine Buchung“. */
  filtered: boolean;
  /** Befund 21/23: gesetzt, sobald nach einem Konto gefiltert wird — dann ist die Seite ein Kontoblatt (eigene Kopfzeile, Saldospalte). */
  accountFilter: { name: string; openingBalanceCents: number | null } | null;
  /** Seitenpanel „Bestände“: unter dem Seitentitel, ab 1680 px neben Werkzeugleiste und Liste (Runde 4, A3). */
  aside?: ReactNode;
}

function VoucherIcon({ state }: { state: JournalRow['documentationState'] }) {
  const tv = useTranslations('finance.journal.voucher');
  if (state === 'voucher') return <FileCheck2 className="size-4 text-ink-2" aria-label={tv('voucher')} />;
  if (state === 'statementSuffices') return <FileStack className="size-4 text-ink-2" aria-label={tv('statementSuffices')} />;
  if (state === 'notApplicable') return <FileX2 className="size-4 text-ink-2" aria-label={tv('notApplicable')} />;
  if (state === 'onOrigin') return <FileSymlink className="size-4 text-ink-2" aria-label={tv('onOrigin')} />;
  return <FileWarning className="size-4 text-warning" aria-label={tv('missing')} />;
}

export function Journal({ rows, total, totals, page, pageSize, standing, accounts, categories, years, unfiltered, canWrite, canFinalize, showSetupLink, filtered, accountFilter, aside }: JournalProps) {
  const t = useTranslations('finance.journal');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Befund 1: Das Journal blättert. Die Filter streichen `page` beim Schreiben der Adresse (`filters.tsx`).
  const pageHref = (offset: number) => {
    const next = new URLSearchParams(params.toString());
    const target = Math.floor(offset / pageSize) + 1;
    if (target > 1) next.set('page', String(target));
    else next.delete('page');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const fmt = useDateFormat();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [confirmFinalizeAll, setConfirmFinalizeAll] = useState(false);
  const [confirmFinalizeSelection, setConfirmFinalizeSelection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // „Als geprüft markieren“ steht in der Auswahlleiste: Die Ablehnung steht unmittelbar darüber.
  const reviewFb = useActionFeedback();

  const toggle = (id: string, index: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIndex.current !== null) {
        const start = Math.min(lastIndex.current, index);
        const end = Math.max(lastIndex.current, index);
        for (let i = start; i <= end; i++) next.add(rows[i]!.id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastIndex.current = index;
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allDrafts = selectedRows.length > 0 && selectedRows.every((r) => r.status === 'draft');
  const allReviewedDrafts = selectedRows.length > 0 && selectedRows.every((r) => r.status === 'draft' && r.reviewedAt !== null);

  const markReviewed = () => {
    startTransition(async () => {
      const result = await reviewFb.run(() => setReviewedManyAction([...selected], true), { retry: markReviewed });
      if (result.status === 'success') {
        toast.success(t('toast.reviewed'));
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const finalizeSelection = async (): Promise<ActionState> => {
    const result = await finalizeReviewedAction([...selected]);
    if (result.status !== 'error') setSelected(new Set());
    router.refresh();
    return result;
  };

  const deleteSelection = async (): Promise<ActionState> => {
    const result = await deleteDraftsAction([...selected]);
    if (result.status !== 'error') setSelected(new Set());
    router.refresh();
    return result;
  };

  const standingText =
    standing.finalizedThrough !== null
      ? t('standing.text', { date: fmt.date(standing.finalizedThrough), count: standing.draftCount, reviewed: standing.reviewedDraftCount })
      : t('standing.textUnfinalized', { count: standing.draftCount, reviewed: standing.reviewedDraftCount });
  const description = accountFilter
    ? t('accountLedger.opening', { amount: formatEuro(accountFilter.openingBalanceCents ?? 0) })
    : standingText;

  return (
    <div>
      <PageHeader
        // Ohne Kontofilter stand der Titel bis 0.2.8 nur als `h1` in der Brotkrume; jetzt ist er das `h1` der Seite
        // (Spec Seitenkopf § 2.2: Seiten ohne Titel bekommen einen).
        title={accountFilter ? t('accountLedger.title', { account: accountFilter.name }) : t('title')}
        description={description}
        // Primärknopf rechts außen, die Nebenaktion davor und am Telefon im ⋯ (Runde 3, 018 und 086).
        more={[
          {
            key: 'finalizeReviewed',
            label: t('actions.finalizeReviewed', { count: standing.reviewedDraftCount }),
            onSelect: () => setConfirmFinalizeAll(true),
            hidden: !(canFinalize && standing.reviewedDraftCount > 0),
          },
        ]}
        actions={
          canWrite ? (
            <Link href="/finance/entries/new" className={buttonVariants()}>
              {t('actions.new')}
            </Link>
          ) : null
        }
      />

      {/* Das Seitenpanel steht unter dem Titel (Runde 4, A3, 212), unter 1680 px über der Werkzeugleiste, ab 1680 px als
          Spalte daneben — sonst scrollte das Journal mit elf Spalten neben 280 px (07-1 B33 · 13 #10). Ohne Layout-Test
          (Einzelstelle). */}
      <div className="flex flex-col-reverse gap-5 min-[1680px]:flex-row min-[1680px]:items-start">
        <div className="min-w-0 flex-1">
          <JournalFilters accounts={accounts} categories={categories} years={years} count={{ shown: total, total: unfiltered }} />

          {rows.length === 0 && filtered ? (
            // Befund 2 (Inventar Filterleisten): Mit Filter nie „Noch keine Buchung“ und „Neue Buchung“, sondern Zurücksetzen.
            <EmptyState filtered={{ noun: t('empty.filteredNoun'), resetHref: '/finance/entries' }} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              text={t('empty.text')}
              action={
                canWrite || showSetupLink ? (
                  <>
                    {canWrite ? (
                      <Link href="/finance/entries/new" className={buttonVariants()}>
                        {t('actions.new')}
                      </Link>
                    ) : null}
                    {showSetupLink ? (
                      <Link href={panelHref('/admin/finance', 'accounts')} className={buttonVariants({ variant: 'outline' })}>
                        {t('empty.setupAction')}
                      </Link>
                    ) : null}
                  </>
                ) : undefined
              }
            />
          ) : (
            <div className="@container/journal mt-3 overflow-hidden rounded-md border border-line bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="select" className="w-9" />
                    <SortableHead col="meta" field="number" label={t('columns.number')} />
                    <SortableHead col="meta" field="entryDate" label={t('columns.date')} />
                    <SortableHead col="title" field="text" label={t('columns.text')} />
                    {/* „Konto“: Mit offener Hilfe und von md bis lg fällt die Spalte weg, damit Betrag und Zustand im Bild bleiben
                        (Runde 3, Kleinpunkt 9); am Telefon steht das Konto als dritter meta-Wert in der Unterzeile der Karte
                        (Rolle `meta`). Die zwei Klassen tun, was sonst „ohne Rolle“ täte — nur nicht am Telefon.
                        Kein Layout-Test (Einzelstelle, Projektregel). */}
                    <TableHead col="meta" className={ACCOUNT_COLUMN_HIDE}>{t('columns.account')}</TableHead>
                    <TableHead>{t('columns.allocation')}</TableHead>
                    <TableHead>{t('columns.contact')}</TableHead>
                    <SortableHead col="amount" field="amount" label={t('columns.amount')} />
                    {accountFilter ? <TableHead>{t('columns.balance')}</TableHead> : null}
                    <TableHead className={TIGHT_HIDE}>{t('columns.voucher')}</TableHead>
                    <TableHead col="status">{t('columns.state')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const reversed = row.status === 'final' && row.reversedByEntryId !== null;
                    const href = row.status === 'draft' ? `/finance/entries/${row.id}/edit` : `/finance/entries/${row.id}`;
                    return (
                      <TableRow key={row.id} data-row-id={row.id}>
                        <TableCell col="select">
                          <Checkbox
                            aria-label={t('selectRow', { number: row.number ?? row.text })}
                            checked={selected.has(row.id)}
                            onClick={(e) => toggle(row.id, index, e.shiftKey)}
                          />
                        </TableCell>
                        <TableCell col="meta" className="font-mono text-meta">
                          {/* Die Fläche dieses Links liegt über der ganzen Zeile (MUSTER.md § G); ein Entwurf hat noch keine Nummer, dann nennt der Text den Link. */}
                          <RowLink href={href} aria-label={row.number ? `${row.number} · ${row.text}` : row.text}>
                            {row.number ?? <Empty />}
                          </RowLink>
                        </TableCell>
                        <TableCell col="meta" className="tabular-nums text-meta text-ink-2">{fmt.date(row.entryDate)}</TableCell>
                        {/* Die Titelspalte kürzt (Joe 11.5): Der Text nimmt den Restplatz, der volle Text steht im title und auf
                            der Buchung. Verweise (zurückgenommen durch, nimmt zurück, Ersatz-Entwurf) stehen in einer eigenen
                            Unterzeile und kürzen nie (Runde 4, 213). Fehlt die Spalte Konto (Breite, Hilfe), steht das Konto
                            darunter wie am Telefon; mit Kontofilter nicht, dort wäre es in jeder Zeile gleich (Runde 4, Frage 2). */}
                        <TableCell col="title" truncate title={row.text}>
                          <span className={cn('block truncate', reversed && 'text-muted-ink line-through')}>{row.text}</span>
                          {(() => {
                            // Die Nummer im Verweis bricht nie um, auch nicht am Bindestrich (Runde 4 Nachtrag, 213).
                            const nr = (chunks: ReactNode) => <span className="whitespace-nowrap">{chunks}</span>;
                            const refs = [
                              reversed && row.reversedByNumber
                                ? { href: `/finance/entries/${row.reversedByEntryId}`, label: t.rich('reversedByLink', { number: row.reversedByNumber, nr }) }
                                : null,
                              row.reversesEntryId && row.reversesNumber
                                ? { href: `/finance/entries/${row.reversesEntryId}`, label: t.rich('reversesLink', { number: row.reversesNumber, nr }) }
                                : null,
                              row.correctionOfEntryId && row.correctionOfNumber
                                ? { href: `/finance/entries/${row.correctionOfEntryId}`, label: t.rich('correctionOfLink', { number: row.correctionOfNumber, nr }) }
                                : null,
                            ].filter((ref) => ref !== null);
                            // Ohne Konto (Sachspende) keine leere Unterzeile „—“ (wie in der Kartenzeile, MUSTER § G).
                            const account = accountFilter || row.accountLabel === EMPTY ? null : row.accountLabel;
                            if (refs.length === 0) {
                              return account === null ? null : (
                                <span className={cn('block truncate text-hint text-muted-ink', ACCOUNT_SUBLINE_SHOW)} data-testid="journal-row-account">
                                  {account}
                                </span>
                              );
                            }
                            // Verweis und Konto teilen sich eine Unterzeile: „nimmt zurück: 2026-0008 · Vereinskonto“ (Runde 4
                            // Nachtrag, 213). Das Konto mit seinem Trenner steht nur, wenn die Spalte Konto fehlt.
                            // Fließender Text statt `flex`: Der Trenner hängt mit geschütztem Leerzeichen am Wort davor, eine
                            // umbrochene Zeile beginnt nie mit „·“.
                            return (
                              <span className="block whitespace-normal text-hint" data-testid="journal-row-refs">
                                {refs.map((ref, i) => (
                                  <Fragment key={ref.href}>
                                    {i > 0 ? '\u00a0· ' : null}
                                    <Link href={ref.href} className="text-link">{ref.label}</Link>
                                  </Fragment>
                                ))}
                                {account === null ? null : (
                                  <span className={cn('text-muted-ink', ACCOUNT_INLINE_SHOW)} data-testid="journal-row-account">
                                    {'\u00a0· '}{account}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell col="meta" className={cn('text-ink-2', ACCOUNT_COLUMN_HIDE)}>{row.accountLabel}</TableCell>
                        <TableCell className="text-ink-2">{row.allocationLabel}</TableCell>
                        <TableCell className="text-ink-2">{row.contactLabel ?? <Empty />}</TableCell>
                        <TableCell col="amount" selectable>
                          <AmountCell cents={row.amountCents} reversed={reversed} />
                          {row.transfer ? <span className="block text-right text-hint text-muted-ink">{t('transfer')}</span> : null}
                        </TableCell>
                        {accountFilter ? (
                          <TableCell>{row.runningBalanceCents !== null ? <AmountCell cents={row.runningBalanceCents} /> : <span className="block text-right text-ink-2"><Empty /></span>}</TableCell>
                        ) : null}
                        <TableCell className={TIGHT_HIDE}>
                          <VoucherIcon state={row.documentationState} />
                        </TableCell>
                        <TableCell col="status">
                          <EntryStateBadge entry={row} inList />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter className="border-t border-line-strong bg-surface-2">
                  <TableRow>
                    {/* Eine Zelle über alle Spalten: links das Etikett, rechts Einnahmen · Ausgaben · Ergebnis als eine Gruppe
                        (Runde 4, B1). */}
                    <TableCell col="span" colSpan={accountFilter ? 11 : 10} className="w-full text-hint">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-muted-ink">{t('totals.label', { count: total })}</span>
                        <span className="ml-auto text-right tabular-nums text-ink-2" data-testid="journal-totals">
                          {t('totals.income', { amount: formatEuro(totals.incomeCents) })} · {t('totals.expense', { amount: formatEuro(-totals.expenseCents) })} · {t('totals.result', { amount: formatEuro(totals.resultCents) })}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <ListPager total={total} offset={(page - 1) * pageSize} pageSize={pageSize} hrefFor={pageHref} footer testId="journal-pager" />
            </div>
          )}

        </div>
        {aside}
      </div>

      {selected.size > 0 ? (
        <div className="mt-3">
          <RefusalNotice action state={reviewFb.state} />
        </div>
      ) : null}
      <SelectionBar count={selected.size} label={t('selection.count', { count: selected.size })}>
        {canWrite ? (
          <Button type="button" variant="outline" onClick={markReviewed}>
            {t('selection.markReviewed')}
          </Button>
        ) : null}
        {canFinalize ? (
          <Button type="button" variant="outline" disabled={!allReviewedDrafts} onClick={() => setConfirmFinalizeSelection(true)}>
            {t('selection.finalize')}
          </Button>
        ) : null}
        {canWrite ? (
          <Button type="button" variant="destructive" disabled={!allDrafts} onClick={() => setConfirmDelete(true)}>
            {t('selection.delete')}
          </Button>
        ) : null}
      </SelectionBar>

      <ConfirmDialog
        open={confirmFinalizeAll}
        onOpenChange={setConfirmFinalizeAll}
        title={t('confirmFinalize.title')}
        description={t('confirmFinalize.description')}
        confirmLabel={t('actions.finalizeReviewed', { count: standing.reviewedDraftCount })}
        action={async () => {
          const result = await finalizeAllReviewedAction();
          router.refresh();
          return result;
        }}
      />
      <ConfirmDialog
        open={confirmFinalizeSelection}
        onOpenChange={setConfirmFinalizeSelection}
        title={t('confirmFinalize.title')}
        description={t('confirmFinalize.description')}
        confirmLabel={t('selection.finalize')}
        action={finalizeSelection}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('confirmDelete.title')}
        description={t('confirmDelete.description')}
        confirmLabel={t('selection.delete')}
        destructive
        action={deleteSelection}
      />
    </div>
  );
}
