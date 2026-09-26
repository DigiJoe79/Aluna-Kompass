'use client';

import { FileCheck2, FileStack, FileWarning, FileX2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { Standing } from '@kompass/module-finance';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { AmountCell } from '@/components/finance/amount-cell';
import { EntryStateBadge } from '@/components/finance/entry-state-badge';
import { PageHeader } from '@/components/page-header';
import { SortableHead } from '@/components/sortable-head';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';
import { deleteDraftsAction, finalizeAllReviewedAction, finalizeReviewedAction, setReviewedManyAction } from './actions';
import { JournalFilters } from './filters';

export interface JournalRow {
  id: string;
  number: string | null;
  entryDate: string;
  text: string;
  accountLabel: string;
  allocationLabel: string;
  contactLabel: string | null;
  amountCents: number;
  documentationState: 'voucher' | 'statementSuffices' | 'notApplicable' | 'missing';
  status: 'draft' | 'final';
  reviewedAt: string | null;
  reversedByEntryId: string | null;
  reversedByNumber: string | null;
  reversesEntryId: string | null;
  reversesNumber: string | null;
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
  canWrite: boolean;
  canFinalize: boolean;
  /** Zweiter Knopf im leeren Journal (Task 3): nur solange ein Konto ohne Anfangsbestand existiert und der Betrachter `finance.setup` hat. */
  showSetupLink: boolean;
}

function VoucherIcon({ state }: { state: JournalRow['documentationState'] }) {
  const tv = useTranslations('finance.journal.voucher');
  if (state === 'voucher') return <FileCheck2 className="size-4 text-ink-2" aria-label={tv('voucher')} />;
  if (state === 'statementSuffices') return <FileStack className="size-4 text-ink-2" aria-label={tv('statementSuffices')} />;
  if (state === 'notApplicable') return <FileX2 className="size-4 text-ink-2" aria-label={tv('notApplicable')} />;
  return <FileWarning className="size-4 text-warning" aria-label={tv('missing')} />;
}

export function Journal({ rows, total, totals, standing, accounts, categories, canWrite, canFinalize, showSetupLink }: JournalProps) {
  const t = useTranslations('finance.journal');
  const router = useRouter();
  const fmt = useDateFormat();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [confirmFinalizeAll, setConfirmFinalizeAll] = useState(false);
  const [confirmFinalizeSelection, setConfirmFinalizeSelection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      const result = await setReviewedManyAction([...selected], true);
      if (result.status === 'error') toast.error(result.message);
      else {
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

  return (
    <div>
      <PageHeader
        description={standingText}
        actions={
          <>
            {canWrite ? (
              <Link href="/finance/entries/new" className={buttonVariants()}>
                {t('actions.new')}
              </Link>
            ) : null}
            {canFinalize && standing.reviewedDraftCount > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setConfirmFinalizeAll(true)}>
                {t('actions.finalizeReviewed', { count: standing.reviewedDraftCount })}
              </Button>
            ) : null}
          </>
        }
      />

      <JournalFilters accounts={accounts} categories={categories} />

      {rows.length === 0 ? (
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
                  <Link href="/admin/finance?panel=accounts" className={buttonVariants({ variant: 'secondary' })}>
                    {t('empty.setupAction')}
                  </Link>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : (
        <div className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader className="bg-table-head text-left text-[11px] font-bold uppercase tracking-[.06em] text-muted-ink">
              <TableRow className="h-9">
                <TableHead className="w-9 px-4" />
                <SortableHead field="number" label={t('columns.number')} />
                <SortableHead field="entryDate" label={t('columns.date')} />
                <SortableHead field="text" label={t('columns.text')} />
                <TableHead className="px-4">{t('columns.account')}</TableHead>
                <TableHead className="px-4">{t('columns.allocation')}</TableHead>
                <TableHead className="px-4">{t('columns.contact')}</TableHead>
                <SortableHead field="amount" label={t('columns.amount')} />
                <TableHead className="px-4">{t('columns.voucher')}</TableHead>
                <TableHead className="px-4">{t('columns.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => {
                const reversed = row.status === 'final' && row.reversedByEntryId !== null;
                const href = row.status === 'draft' ? `/finance/entries/${row.id}/edit` : `/finance/entries/${row.id}`;
                return (
                  <TableRow
                    key={row.id}
                    data-row-id={row.id}
                    tabIndex={0}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(href);
                    }}
                    className={cn('h-row cursor-pointer border-b border-line-2 hover:bg-row-hover', index % 2 === 1 && 'bg-zebra')}
                  >
                    <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={t('selectRow', { number: row.number ?? row.text })}
                        checked={selected.has(row.id)}
                        onClick={(e) => toggle(row.id, index, e.shiftKey)}
                      />
                    </TableCell>
                    <TableCell className="px-4 font-mono text-[13px]">{row.number ?? '—'}</TableCell>
                    <TableCell className="px-4 font-mono text-[13px] text-ink-2">{fmt.date(row.entryDate)}</TableCell>
                    <TableCell className={cn('px-4', reversed && 'text-muted-ink line-through')}>
                      {row.text}
                      {reversed && row.reversedByNumber ? (
                        <>
                          {' '}
                          <Link href={`/finance/entries/${row.reversedByEntryId}`} onClick={(e) => e.stopPropagation()} className="not-italic text-[12px] font-normal text-link no-underline">
                            {t('reversedByLink', { number: row.reversedByNumber })}
                          </Link>
                        </>
                      ) : null}
                      {row.reversesEntryId && row.reversesNumber ? (
                        <>
                          {' '}
                          <Link href={`/finance/entries/${row.reversesEntryId}`} onClick={(e) => e.stopPropagation()} className="text-[12px] text-link">
                            {t('reversesLink', { number: row.reversesNumber })}
                          </Link>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-4 text-ink-2">{row.accountLabel}</TableCell>
                    <TableCell className="px-4 text-ink-2">{row.allocationLabel}</TableCell>
                    <TableCell className="px-4 text-ink-2">{row.contactLabel ?? '—'}</TableCell>
                    <TableCell className="px-4">
                      <AmountCell cents={row.amountCents} reversed={reversed} />
                    </TableCell>
                    <TableCell className="px-4">
                      <VoucherIcon state={row.documentationState} />
                    </TableCell>
                    <TableCell className="px-4">
                      <EntryStateBadge entry={row} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter className="border-t border-line-strong bg-surface-2">
              <TableRow>
                <TableCell colSpan={7} className="px-4 text-[12px] text-muted-ink">
                  {t('totals.label', { count: total })}
                </TableCell>
                <TableCell className="px-4 text-[12px] text-ink-2">{t('totals.income', { amount: formatEuro(totals.incomeCents) })}</TableCell>
                <TableCell colSpan={2} className="px-4 text-[12px] text-ink-2">
                  {t('totals.expense', { amount: formatEuro(-totals.expenseCents) })} · {t('totals.result', { amount: formatEuro(totals.resultCents) })}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {selected.size > 0 ? (
        <div role="toolbar" className="sticky bottom-0 mt-3 flex items-center gap-3 rounded-md bg-ink px-4 py-2.5 text-surface">
          <span aria-live="polite" className="text-[13px] font-semibold">
            {t('selection.count', { count: selected.size })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {canWrite ? (
              <Button type="button" variant="secondary" onClick={markReviewed}>
                {t('selection.markReviewed')}
              </Button>
            ) : null}
            {canFinalize ? (
              <Button type="button" variant="secondary" disabled={!allReviewedDrafts} onClick={() => setConfirmFinalizeSelection(true)}>
                {t('selection.finalize')}
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="button" variant="destructive" disabled={!allDrafts} onClick={() => setConfirmDelete(true)}>
                {t('selection.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

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
