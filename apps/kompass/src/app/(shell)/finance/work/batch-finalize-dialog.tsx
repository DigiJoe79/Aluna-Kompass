'use client';

import type { BatchFinalizePreview } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
  const tCommon = useTranslations('common');
  const { date } = useDateFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setLoaded({ state: 'loading' });
    void previewBatchFinalizeAction().then((result) => setLoaded(result.ok ? { state: 'ready', preview: result.preview } : { state: 'failed', message: result.message }));
  }, [open]);

  const preview = loaded.state === 'ready' ? loaded.preview : null;
  const blocked = !!preview && preview.problems.length > 0;

  const finalize = () =>
    startTransition(async () => {
      const result = await finalizeAllReviewedAction();
      if (result.status === 'error') {
        toast.error(result.message);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {t('confirm')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[680px]">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
          <div className="space-y-3 text-[13px]">
            {loaded.state === 'loading' ? <p className="text-ink-2">{t('loading')}</p> : null}
            {loaded.state === 'failed' ? <Notice level="refuse">{loaded.message || t('failed')}</Notice> : null}
            {preview ? (
              <>
                <p className="text-ink-2">{t('intro', { count: preview.entries || reviewedCount })}</p>
                <table className="w-full text-left">
                  <thead className="text-[12px] uppercase tracking-[.04em] text-muted-ink">
                    <tr className="border-b border-line">
                      <th className="py-1.5 pr-3 font-semibold">{t('account')}</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">{t('sum')}</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">{t('bookAfter')}</th>
                      <th className="py-1.5 font-semibold">{t('statement')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.byAccount.map((row) => {
                      const state = batchAccountState(row);
                      return (
                        <tr key={row.accountId} className="border-b border-line-2 align-top">
                          <td className="py-1.5 pr-3 font-medium text-ink">{row.accountName}</td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatEuro(row.sumCents)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatEuro(row.bookCentsAfter)}</td>
                          <td className="py-1.5 text-ink-2">
                            {state.state === 'cash' ? t('cash') : null}
                            {state.state === 'noStatement' ? t('noStatement') : null}
                            {state.state === 'matches' || state.state === 'differs' ? (
                              <span className="font-mono tabular-nums">
                                {t('statementOf', { amount: formatEuro(row.statementClosingCents ?? 0), date: formatDateOrDash(date, row.statementDate) })}
                                {state.state === 'matches' ? <span className="ml-1 font-sans text-success">✓ {t('matches')}</span> : null}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.byAccount.map((row) => {
                  const state = batchAccountState(row);
                  return state.state === 'differs' ? (
                    <Notice key={row.accountId} level="warn">
                      {t('differs', { account: row.accountName, difference: formatEuro(state.differenceCents ?? 0), date: formatDateOrDash(date, row.statementDate) })}
                    </Notice>
                  ) : null;
                })}
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={finalize} disabled={pending || !preview || blocked}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
