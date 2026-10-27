'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveContactTaxDetailsAction } from '../tax/actions';

/**
 * „Angaben zum Geber“ (Board 15g B, Dialog `sm`): Wer eine Vermögensausstattung ankreuzt, nennt den Geber mit
 * Finanzamt und Steuernummer — Zeile 70 der Anlage Gem. Die Angaben stehen am Kontakt; leere Felder lassen
 * vorhandene stehen. „Übernehmen“ setzt den Geber als Kontakt der Zeile.
 */
export function GiverDialog({ contact, onDone, onClose }: { contact: PickedContact | null; onDone: (contact: PickedContact) => void; onClose: () => void }) {
  const t = useTranslations('finance.entryForm.giverDialog');
  const [giver, setGiver] = useState<PickedContact | null>(contact);
  const [taxOffice, setTaxOffice] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const save = async () => {
    if (!giver) return;
    setPending(true);
    const result = await feedback.run(() => saveContactTaxDetailsAction({ contactId: giver.id, ...(taxOffice.trim() ? { taxOffice } : {}), ...(taxNumber.trim() ? { taxNumber } : {}) }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') onDone(giver);
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="giver-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormCell size="full">
              <ContactPicker id="giver-contact" name="giverContactId" label={t('giver')} value={giver} onChange={setGiver} required />
            </FormCell>
            <FormField id="giver-tax-office" label={t('taxOffice')} error={errors.taxOffice} size="full">
              <Input id="giver-tax-office" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} />
            </FormField>
            <FormField id="giver-tax-number" label={t('taxNumber')} error={errors.taxNumber} size="full">
              <Input id="giver-tax-number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveDisabled={!giver} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['taxOffice', 'taxNumber'])} testId="giver-footer" />
      </DialogContent>
    </Dialog>
  );
}
