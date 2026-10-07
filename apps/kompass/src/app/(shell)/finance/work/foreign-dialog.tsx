'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { markForeignAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

/** Ein früherer Eingang fremden Gelds, den ein Ausgang zurückzahlen kann — Text schon gesetzt. */
export interface ForeignReturnOption {
  lineId: string;
  label: string;
}

/**
 * „Gehört nicht dem Verein“ (F5 Task 8, Annahme 4): der Pflichtsatz „Für wen
 * ist das Geld?“, bei einem Ausgang dazu die Wahl, welchen früheren Eingang er
 * zurückzahlt. Ob der Satz fehlt, sagt der Dienst (`foreignNeedsHolder`) — die
 * Ablehnung steht im Dialog, die Eingaben bleiben.
 */
export function ForeignDialog({
  open,
  onOpenChange,
  rawTransactionId,
  outgoing,
  returnOptions,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawTransactionId: string;
  outgoing: boolean;
  returnOptions: ForeignReturnOption[];
  onDone: () => void;
}) {
  const t = useTranslations('finance.work.foreign');
  const [holder, setHolder] = useState('');
  const [returnsLineId, setReturnsLineId] = useState('');
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setHolder('');
    setReturnsLineId('');
    resetFeedback();
  }, [open, resetFeedback]);

  const save = () =>
    startTransition(async () => {
      const result = await feedback.run(() => markForeignAction({ rawTransactionId, holder, ...(returnsLineId ? { returnsLineId } : {}) }), { retry: save });
      if (result.status !== 'success') return;
      onOpenChange(false);
      onDone();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <div className="space-y-3 text-[13px]">
          <p className="text-ink-2">{t('intro')}</p>
          <FormGrid>
            {outgoing && returnOptions.length > 0 ? (
              <FormField id="foreign-returns" label={t('returns')}>
                <Select id="foreign-returns" value={returnsLineId} onChange={(e) => setReturnsLineId(e.target.value)}>
                  <option value="">{t('returnsNone')}</option>
                  {returnOptions.map((o) => (
                    <option key={o.lineId} value={o.lineId}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField id="foreign-holder" label={t('holder')} required hint={t('holderHint')}>
              <Input id="foreign-holder" value={holder} onChange={(e) => setHolder(e.target.value)} aria-invalid={feedback.state.status === 'error' && feedback.state.code === 'foreignNeedsHolder'} />
            </FormField>
          </FormGrid>
        </div>
        <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={save} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
