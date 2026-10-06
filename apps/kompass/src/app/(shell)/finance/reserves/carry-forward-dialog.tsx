'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { carryForwardAction } from './actions';
import { ResolutionField } from './resolution-field';
import { DocumentLabel, type ReserveRow } from './reserve-table';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

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
  const feedback = useActionFeedback();

  const amountCents = amountText.trim() === '' ? null : parseAmount(amountText);
  // Ein schon hinterlegter Vortragsbeschluss genügt; sonst ist einer Pflicht.
  const hasDocument = !!reserve.carryForwardDocument || !!document || !!file;
  const canSave = amountCents !== null && amountCents >= 0 && !!date && hasDocument && !(document && file);

  const submit = async () => {
    setPending(true);
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
    const result = await feedback.run(() => carryForwardAction(formData), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title', { name: reserve.name })}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">{t('hint')}</DialogDescription>
        <div className="space-y-3.5" data-testid="carry-forward-dialog">
          <FormGrid>
            <FormField id="carry-forward-amount" label={t('amount')} required size="s">
              <Input id="carry-forward-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={formatAmount(0)} />
            </FormField>
            <FormField id="carry-forward-date" label={t('date')} required size="s">
              <Input id="carry-forward-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </FormGrid>
          {reserve.carryForwardDocument ? (
            <p className="text-[13px] text-ink-2">
              {t('currentDocument')} <DocumentLabel document={reserve.carryForwardDocument} />
            </p>
          ) : null}
          <ResolutionField id="carry-forward-resolution" document={document} onDocument={setDocument} onFile={setFile} />
          <p className="text-[12px] text-muted-ink">{t('documentRequired')}</p>
        </div>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!canSave} saveLabel={t('save')} saveTestId="carry-forward-save" onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
