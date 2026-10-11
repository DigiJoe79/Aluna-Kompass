'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AmountField } from '@/components/finance/amount-field';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveOpenItemAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';

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
 * Abschnitt Zahlung (Art, Betrag, Datum, fällig am) und Gegenüber (Kontakt,
 * Verwendungszweck, Dokument optional). Ohne `item` legt der Dialog an, mit `item` ändert er.
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
  const feedback = useActionFeedback();

  const amountCents = parseAmount(amountText);

  const submit = async () => {
    if (amountCents === null) return;
    setPending(true);
    const result = await feedback.run(() => saveOpenItemAction({
      id: item?.id,
      expectedVersion: item?.expectedVersion,
      kind,
      itemDate,
      contactId: contact?.id ?? null,
      amountCents,
      dueOn: dueOn || null,
      documentId: document?.id ?? null,
      paymentReference: reference.trim() || null,
    }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onOpenChange(false);
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="bg-surface shadow-md">
        <DialogTitle>{item ? t('editTitle') : t('newTitle')}</DialogTitle>
        <Section title={t('sections.payment')}>
          <FormGrid>
            <FormField id="open-item-kind" label={t('kind')} size="s">
              <Select id="open-item-kind" value={kind} onChange={(e) => setKind(e.target.value as 'receivable' | 'payable')}>
                <option value="payable">{t('kindOptions.payable')}</option>
                <option value="receivable">{t('kindOptions.receivable')}</option>
              </Select>
            </FormField>
            <FormField id="open-item-amount" label={t('amount')} required size="s">
              <AmountField id="open-item-amount" name="amount" value={amountText} onChange={setAmountText} required />
            </FormField>
            <FormField id="open-item-date" label={t('itemDate')} required size="s">
              <Input id="open-item-date" type="date" value={itemDate} onChange={(e) => setItemDate(e.target.value)} required />
            </FormField>
            <FormField id="open-item-due" label={t('dueOn')} size="s">
              <Input id="open-item-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('sections.counterparty')}>
          <FormGrid>
            <FormCell size="m">
              <ContactPicker id="open-item-contact" name="contact" label={t('contact')} value={contact} onChange={setContact} canCreate={canCreateContact} />
            </FormCell>
            <FormField id="open-item-reference" label={t('reference')}>
              <Input id="open-item-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
            <FormCell size="m">
              <DocumentPicker id="open-item-document" name="document" label={t('document')} value={document} onChange={setDocument} />
            </FormCell>
          </FormGrid>
        </Section>
        <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={pending} saveDisabled={amountCents === null || !itemDate} saveLabel={t('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, [])} />
      </DialogContent>
    </Dialog>
  );
}
