'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { markForeignAction } from './actions';

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
  const tCommon = useTranslations('common');
  const [holder, setHolder] = useState('');
  const [returnsLineId, setReturnsLineId] = useState('');
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setHolder('');
    setReturnsLineId('');
    setRefusal(null);
  }, [open]);

  const save = () =>
    startTransition(async () => {
      const result = await markForeignAction({ rawTransactionId, holder, ...(returnsLineId ? { returnsLineId } : {}) });
      if (result.status === 'error') {
        setRefusal(result);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      onOpenChange(false);
      onDone();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <div className="space-y-3 text-[13px]">
          <p className="text-ink-2">{t('intro')}</p>
          {outgoing && returnOptions.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor="foreign-returns">{t('returns')}</Label>
              <Select id="foreign-returns" value={returnsLineId} onChange={(e) => setReturnsLineId(e.target.value)}>
                <option value="">{t('returnsNone')}</option>
                {returnOptions.map((o) => (
                  <option key={o.lineId} value={o.lineId}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="foreign-holder" required>
              {t('holder')}
            </Label>
            <Input id="foreign-holder" value={holder} onChange={(e) => setHolder(e.target.value)} aria-invalid={refusal?.code === 'foreignNeedsHolder'} />
            <p className="text-[12px] text-muted-ink">{t('holderHint')}</p>
          </div>
          {refusal ? <Notice level="refuse">{refusal.detail ?? refusal.message}</Notice> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
