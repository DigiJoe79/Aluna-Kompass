'use client';

import type { DiscardPreview } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ConsequenceList } from '@/components/consequence-list';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
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
  const { date } = useDateFormat();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;

  useEffect(() => {
    if (!open || !run) return;
    setNote('');
    resetFeedback();
    setLoaded({ state: 'loading' });
    void previewDiscardRunAction(run.id).then((preview) => setLoaded(preview ? { state: 'ready', preview } : { state: 'failed' }));
  }, [open, run, resetFeedback]);

  if (!run) return null;
  const preview = loaded.state === 'ready' ? loaded.preview : null;
  const blocked = !!preview && preview.blocking.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" role="alertdialog" className="bg-surface shadow-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription tone="body">{t('description')}</DialogDescription>

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
                      <Link href={`/finance/entries/${b.entryId}`} className="text-link">
                        {b.number} · {date(b.entryDate)} · {formatEuro(b.amountCents)}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-ink-2">{t('blocked.hint')}</p>
              </div>
            ) : (
              <FormGrid>
                <FormField id="discardNote" label={t('noteLabel')} required size="l">
                  <Textarea id="discardNote" required value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </FormField>
              </FormGrid>
            )}
          </>
        ) : null}

        {blocked ? (
          // Sperren festgeschriebene Buchungen, gibt es kein „Verwerfen“, nur den Weg ins Journal (Spec 6.1).
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        ) : (
          <FormActionBar
            placement="dialog"
            cancel={() => onOpenChange(false)}
            destructive
            pending={pending}
            saveDisabled={!preview || note.trim().length === 0}
            saveLabel={tCommon('discard')}
            state={feedback.state}
            onSave={() =>
              start(async () => {
                const result = await feedback.run(() => discardRunAction(run.id, note));
                if (result.status !== 'success') return;
                onOpenChange(false);
                router.refresh();
              })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
