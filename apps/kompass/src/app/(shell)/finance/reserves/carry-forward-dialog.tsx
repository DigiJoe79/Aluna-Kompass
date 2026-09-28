'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { carryForwardAction } from './actions';
import { ResolutionField } from './resolution-field';
import { DocumentLabel, type ReserveRow } from './reserve-table';

/**
 * „Vortrag erfassen“ (Befund 40): Betrag, Stichtag und Beschluss zusammen —
 * der Bestand aus der Zeit vor Kompass. Ein Dienstaufruf wie
 * `finance_reserve_carry_forward` (Teil C Task 2).
 */
export function CarryForwardDialog({ reserve, onClose, onSaved }: { reserve: ReserveRow; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('finance.reserves.carryForward');
  const [amountText, setAmountText] = useState(reserve.carryForwardCents !== null ? formatAmount(reserve.carryForwardCents) : '');
  const [date, setDate] = useState(reserve.carryForwardDate ?? '');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = amountText.trim() === '' ? null : parseAmount(amountText);
  // Ein schon hinterlegter Vortragsbeschluss genügt; sonst ist einer Pflicht.
  const hasDocument = !!reserve.carryForwardDocument || !!document || !!file;
  const canSave = !pending && amountCents !== null && amountCents >= 0 && !!date && hasDocument && !(document && file);

  const submit = async () => {
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.append(
      'reserve',
      JSON.stringify({
        id: reserve.id,
        expectedVersion: reserve.updatedAt,
        kind: reserve.kind,
        name: reserve.name,
        purposeText: reserve.purposeText,
        purposeId: reserve.purposeId,
        carryForwardCents: amountCents,
        carryForwardDate: date,
        isActive: reserve.isActive,
      }),
    );
    formData.append('id', reserve.id);
    if (document) formData.append('documentId', document.id);
    if (file) formData.append('file', file);
    const result = await carryForwardAction(formData);
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[480px]">
        <DialogTitle className="font-heading text-[19px]">{t('title', { name: reserve.name })}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">{t('hint')}</DialogDescription>
        <div className="space-y-3.5" data-testid="carry-forward-dialog">
          {error ? (
            <Notice level="refuse">
              <span role="alert">{error}</span>
            </Notice>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="carry-forward-amount" required>
                {t('amount')}
              </Label>
              <Input id="carry-forward-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="carry-forward-date" required>
                {t('date')}
              </Label>
              <Input id="carry-forward-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {reserve.carryForwardDocument ? (
            <p className="text-[13px] text-ink-2">
              {t('currentDocument')} <DocumentLabel document={reserve.carryForwardDocument} />
            </p>
          ) : null}
          <ResolutionField id="carry-forward-resolution" document={document} onDocument={setDocument} onFile={setFile} />
          <p className="text-[12px] text-muted-ink">{t('documentRequired')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void submit()} data-testid="carry-forward-save">
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
