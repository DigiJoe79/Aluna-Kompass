'use client';

import type { DiscardPreview } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConsequenceList } from '@/components/consequence-list';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { formatEuro } from '@/lib/finance/amount';
import { discardRunAction, previewDiscardRunAction } from './actions';
import type { RunRow } from './runs-table';

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; preview: DiscardPreview };

/**
 * „Auszug verwerfen“ (F4 Task 7, Spec 6.1): Folgen in Zahlen, dazu „Was
 * bleibt“. **Sperren festgeschriebene Buchungen**, ist der „Verwerfen“-Knopf
 * **nicht sichtbar** — stattdessen der Weg ins gefilterte Journal. Sonst
 * verlangt der Dialog eine Pflichtnotiz, nie ins Änderungsprotokoll
 * geschrieben (`discardRun` selbst hält das ein).
 */
export function DiscardRunDialog({ open, onOpenChange, run }: { open: boolean; onOpenChange: (open: boolean) => void; run: RunRow | null }) {
  const t = useTranslations('finance.imports.discard');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !run) return;
    setNote('');
    setLoaded({ state: 'loading' });
    void previewDiscardRunAction(run.id).then((preview) => setLoaded(preview ? { state: 'ready', preview } : { state: 'failed' }));
  }, [open, run]);

  if (!run) return null;
  const preview = loaded.state === 'ready' ? loaded.preview : null;
  const blocked = !!preview && preview.blocking.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>

        {loaded.state === 'loading' ? <p className="text-[14px] text-ink-2">{tCommon('loading')}</p> : null}
        {loaded.state === 'failed' ? <p className="text-[14px] text-ink-2">{t('failed')}</p> : null}

        {preview ? (
          <>
            <ConsequenceList
              items={[
                { number: preview.rawTransactions, label: t('consequence.rawTransactions', { count: preview.rawTransactions }) },
                { number: preview.drafts, label: t('consequence.drafts', { count: preview.drafts, reviewed: preview.reviewedDrafts }) },
              ]}
              stays={preview.vouchersKept > 0 ? [t('stays.vouchers', { count: preview.vouchersKept })] : undefined}
            />

            {blocked ? (
              <div className="space-y-2">
                <p className="text-[14px] font-semibold text-error">{t('blocked.title')}</p>
                <ul className="space-y-1 text-[13px]">
                  {preview.blocking.map((b) => (
                    <li key={b.entryId}>
                      {b.number} · {b.entryDate} · {formatEuro(b.amountCents)}
                    </li>
                  ))}
                </ul>
                <Link href={`/finance/entries?account=${run.accountId}`} className={buttonVariants({ variant: 'secondary' })}>
                  {t('blocked.goToJournal')}
                </Link>
              </div>
            ) : (
              <label className="block space-y-1 text-[13px]">
                <span className="font-semibold">{t('noteLabel')}</span>
                <textarea required value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-line-strong bg-field px-2.5 py-1.5 text-[13px]" rows={2} />
              </label>
            )}
          </>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          {!blocked ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !preview || note.trim().length === 0}
              onClick={() =>
                start(async () => {
                  const result = await discardRunAction(run.id, note);
                  if (result.status === 'error') toast.error(result.message);
                  else {
                    if (result.status === 'success' && result.message) toast.success(result.message);
                    onOpenChange(false);
                    router.refresh();
                  }
                })
              }
            >
              {tCommon('discard')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
