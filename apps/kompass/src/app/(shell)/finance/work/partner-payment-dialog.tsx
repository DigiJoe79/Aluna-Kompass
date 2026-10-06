'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Notice } from '@/components/notice';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { FormField } from '@/components/forms/form-field';

export interface WorkPartnerOption {
  id: string;
  contactId: string;
  name: string;
  usualBasis: 'transfer58' | 'agent57' | null;
}

/**
 * „Als Zahlung an Partner erfassen“ (Design-Nachtrag Phase 4, Task 5,
 * Entscheidung 10, Befund 39): nur bei ausgehenden Umsätzen, nur mit
 * `finance.entriesWrite` (wie die Partnerseite). Den Partner wählt man hier;
 * gebucht und angelegt wird über dieselben Dienste wie per MCP
 * (`finance_transaction_book`, `finance_partner_payment_draft_save` mit
 * `retroactive` und der Zeile als bezahlter Zeile).
 */
export function PartnerPaymentDialog({
  open,
  onOpenChange,
  partners,
  state,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: WorkPartnerOption[];
  /** Die Ablehnung des Dienstes beim letzten Versuch. */
  state: ActionState;
  pending: boolean;
  onConfirm: (partner: WorkPartnerOption) => void;
}) {
  const t = useTranslations('finance.work.partnerPayment');
  const [partnerId, setPartnerId] = useState('');
  useEffect(() => {
    if (open) setPartnerId('');
  }, [open]);
  const chosen = partners.find((p) => p.id === partnerId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <div className="space-y-3" data-testid="work-partner-payment">
          <p className="text-[13px] text-ink-2">{t('text')}</p>
          {partners.length === 0 ? (
            <Notice level="hint">{t('none')}</Notice>
          ) : (
            <FormField id="work-partner" label={t('partner')} required>
              <Select id="work-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">{t('choose')}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
        </div>
        <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={pending} saveDisabled={!chosen} saveLabel={t('confirm')} onSave={() => chosen && onConfirm(chosen)} state={state} />
      </DialogContent>
    </Dialog>
  );
}
