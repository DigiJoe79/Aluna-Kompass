'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AmountField } from '@/components/finance/amount-field';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { saveOpenItemAction } from './actions';

export interface OpenItemEditable {
  id: string;
  expectedVersion: string;
  kind: 'receivable' | 'payable';
  itemDate: string;
  contactId: string | null;
  contactLabel: string | null;
  amountCents: number;
  dueOn: string | null;
  paymentReference: string | null;
}

/**
 * „Offene Zahlung anlegen“/„ändern“ (Task 3, A6, `finance.entriesWrite`):
 * Art, Datum, Kontakt, Betrag, fällig am, Verwendungszweck, Dokument
 * (optional). Ohne `item` legt der Dialog an, mit `item` ändert er.
 */
export function ItemDialog({ open, onOpenChange, item, defaultKind, canCreateContact, today }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: OpenItemEditable | null;
  defaultKind: 'receivable' | 'payable';
  canCreateContact: boolean;
  today: string;
}) {
  const t = useTranslations('finance.openItems.dialog');
  const router = useRouter();
  const [kind, setKind] = useState<'receivable' | 'payable'>(item?.kind ?? defaultKind);
  const [itemDate, setItemDate] = useState(item?.itemDate ?? today);
  const [contact, setContact] = useState<PickedContact | null>(item?.contactId ? { id: item.contactId, name: item.contactLabel ?? item.contactId } : null);
  const [amountText, setAmountText] = useState(item ? formatAmount(item.amountCents) : '');
  const [dueOn, setDueOn] = useState(item?.dueOn ?? '');
  const [reference, setReference] = useState(item?.paymentReference ?? '');
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseAmount(amountText);

  const submit = async () => {
    if (amountCents === null) return;
    setPending(true);
    setError(null);
    const result = await saveOpenItemAction({
      id: item?.id,
      expectedVersion: item?.expectedVersion,
      kind,
      itemDate,
      contactId: contact?.id ?? null,
      amountCents,
      dueOn: dueOn || null,
      documentId: document?.id ?? null,
      paymentReference: reference.trim() || null,
    });
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{item ? t('editTitle') : t('newTitle')}</DialogTitle>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="open-item-kind">{t('kind')}</Label>
            <Select id="open-item-kind" value={kind} onChange={(e) => setKind(e.target.value as 'receivable' | 'payable')}>
              <option value="payable">{t('kindOptions.payable')}</option>
              <option value="receivable">{t('kindOptions.receivable')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="open-item-date" required>{t('itemDate')}</Label>
            <Input id="open-item-date" type="date" value={itemDate} onChange={(e) => setItemDate(e.target.value)} required />
          </div>
          <ContactPicker id="open-item-contact" name="contact" label={t('contact')} value={contact} onChange={setContact} canCreate={canCreateContact} />
          <div className="space-y-1.5">
            <Label htmlFor="open-item-amount" required>{t('amount')}</Label>
            <AmountField id="open-item-amount" name="amount" value={amountText} onChange={setAmountText} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="open-item-due">{t('dueOn')}</Label>
            <Input id="open-item-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="open-item-reference">{t('reference')}</Label>
            <Input id="open-item-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <DocumentPicker id="open-item-document" name="document" label={t('document')} value={document} onChange={setDocument} />
          {error ? <p role="alert" className="text-[12px] text-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button type="button" disabled={pending || amountCents === null || !itemDate} onClick={() => void submit()}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
