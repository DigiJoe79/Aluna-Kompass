'use client';

import type { BatchFinalizePreview } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { formatDateOrDash } from '@/lib/finance/dates';
import { batchAccountState } from '@/lib/finance/work-dialogs';
import { finalizeAllReviewedAction } from '../entries/actions';
import { previewBatchFinalizeAction } from './actions';

type Loaded = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; preview: BatchFinalizePreview };

const PROBLEM_KEYS = new Set(['accountInactive', 'categoryInactive', 'entryUnbalanced', 'fiscalYearClosed']);

/**
 * Sammel-Festschreiben aus der Arbeitsliste (F5 Task 8, Annahme 9): vorher je
 * Konto Summe, Buchbestand danach und der Endsaldo laut jüngstem Auszug — eine
 * Abweichung als Warnung, eine Kasse ohne Auszug —, wie viele Nummern
 * vergeben werden und was im Weg steht. Festgeschrieben wird mit dem Knopf
 * des Journals: alle geprüften Entwürfe, alle oder keiner.
 */
export function BatchFinalizeDialog({ reviewedCount }: { reviewedCount: number }) {
  const t = useTranslations('finance.work.batch');
  const { date } = useDateFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [pending, startTransition] = useTransition();
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;

  useEffect(() => {
    if (!open) return;
    resetFeedback();
    setLoaded({ state: 'loading' });
    void previewBatchFinalizeAction().then((result) => setLoaded(result.ok ? { state: 'ready', preview: result.preview } : { state: 'failed', message: result.message }));
  }, [open, resetFeedback]);

  const preview = loaded.state === 'ready' ? loaded.preview : null;
  const blocked = !!preview && preview.problems.length > 0;

  const finalize = () =>
    startTransition(async () => {
      const result = await feedback.run(() => finalizeAllReviewedAction(), { retry: finalize });
      if (result.status !== 'success') return;
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {t('confirm')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="bg-surface shadow-md">
          <DialogTitle>{t('title')}</DialogTitle>
          <div className="space-y-3 text-[13px]">
            {loaded.state === 'loading' ? <p className="text-ink-2">{t('loading')}</p> : null}
            {loaded.state === 'failed' ? <Notice level="refuse">{loaded.message || t('failed')}</Notice> : null}
            {preview ? (
              <>
                <p className="text-ink-2">{t('intro', { count: preview.entries || reviewedCount })}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('account')}</TableHead>
                      <TableHead className="text-right">{t('sum')}</TableHead>
                      <TableHead className="text-right">{t('bookAfter')}</TableHead>
                      <TableHead>{t('statement')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.byAccount.map((row) => {
                      const state = batchAccountState(row);
                      return (
                        <TableRow key={row.accountId}>
                          <TableCell className="align-top font-medium text-ink">{row.accountName}</TableCell>
                          <TableCell className="text-right align-top font-mono tabular-nums">{formatEuro(row.sumCents)}</TableCell>
                          <TableCell className="text-right align-top font-mono tabular-nums">{formatEuro(row.bookCentsAfter)}</TableCell>
                          <TableCell className="align-top text-ink-2">
                            {state.state === 'cash' ? t('cash') : null}
                            {state.state === 'noStatement' ? t('noStatement') : null}
                            {state.state === 'matches' || state.state === 'differs' ? (
                              <span className="font-mono tabular-nums">
                                {t('statementOf', { amount: formatEuro(row.statementClosingCents ?? 0), date: formatDateOrDash(date, row.statementDate) })}
                                {state.state === 'matches' ? <span className="ml-1 font-sans text-success">✓ {t('matches')}</span> : null}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {preview.byAccount.map((row) => {
                  const state = batchAccountState(row);
                  return state.state === 'differs' ? (
                    <Notice key={row.accountId} level="warn">
                      {t('differs', { account: row.accountName, difference: formatEuro(state.differenceCents ?? 0), date: formatDateOrDash(date, row.statementDate) })}
                    </Notice>
                  ) : null;
                })}
                {preview.byAccount.map((row) =>
                  row.negative ? (
                    <Notice key={`negative-${row.accountId}`} level="warn">
                      {t('negative', { account: row.accountName, amount: formatEuro(row.bookCentsAfter) })}
                    </Notice>
                  ) : null,
                )}
                <p className="font-semibold text-ink">{t('numbers', { count: preview.numbersToBeAssigned })}</p>
                {blocked ? (
                  <Notice level="refuse" title={t('problemsTitle')}>
                    <ul className="space-y-1">
                      {preview.problems.map((p) => (
                        <li key={`${p.entryId}-${p.code}`}>
                          {t(`problem.${PROBLEM_KEYS.has(p.code) ? p.code : 'other'}`)}{' '}
                          <Link href={`/finance/entries/${p.entryId}`} className="font-semibold underline underline-offset-2">
                            {t('openEntry')}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
              </>
            ) : null}
          </div>
          <FormActionBar placement="dialog" cancel={() => setOpen(false)} pending={pending} saveDisabled={!preview || blocked} saveLabel={t('confirm')} onSave={finalize} state={feedback.state} />
        </DialogContent>
      </Dialog>
    </>
  );
}
