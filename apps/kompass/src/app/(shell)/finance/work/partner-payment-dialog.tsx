'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

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
  error,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: WorkPartnerOption[];
  error: string | null;
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
      <DialogContent>
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <div className="space-y-3" data-testid="work-partner-payment">
          <p className="text-[13px] text-ink-2">{t('text')}</p>
          {partners.length === 0 ? (
            <Notice level="hint">{t('none')}</Notice>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="work-partner" required>
                {t('partner')}
              </Label>
              <Select id="work-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">{t('choose')}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {error ? (
            <Notice level="refuse" title={t('title')}>
              {error}
            </Notice>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!chosen || pending} onClick={() => chosen && onConfirm(chosen)}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
