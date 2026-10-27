'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ao52PurposeOf } from '@kompass/module-finance/format';
import { Ao52Options } from '@/lib/finance/ao52-options';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveContactTaxDetailsAction } from './actions';

export interface EndowmentParty {
  contactId: string;
  name: string;
  taxOffice: string | null;
  taxNumber: string | null;
  purpose: string | null;
  /** Zeile 65 (Empfänger) oder 70 (Geber). */
  role: 'recipient' | 'giver';
}

/**
 * „Angaben zum Empfänger …“ bzw. „… Geber …“ an einer Lücke in Zeile 65/70 (Board 5a, 15g; Dialog `md`): Finanzamt,
 * Steuernummer, begünstigter Zweck der Körperschaft. Gespeichert am Kontakt — dieselben Steuerdaten zeigt das
 * Partnerprofil. Recht `finance.entriesWrite` wie der Dienst.
 */
export function EndowmentPartyDialog({ party, onClose }: { party: EndowmentParty; onClose: () => void }) {
  const t = useTranslations('finance.tax.partyDialog');
  const router = useRouter();
  const [taxOffice, setTaxOffice] = useState(party.taxOffice ?? '');
  const [taxNumber, setTaxNumber] = useState(party.taxNumber ?? '');
  const [purpose, setPurpose] = useState(party.purpose ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => feedback.reset(), [party.contactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveContactTaxDetailsAction({ contactId: party.contactId, taxOffice, taxNumber, beneficiaryPurpose: purpose }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md" data-testid="tax-party-dialog">
        <DialogHeader>
          <DialogTitle>{t(`title.${party.role}`)}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FixedValue id="tax-party-name" label={t(`party.${party.role}`)} value={party.name} reason={t('partyReason')} size="full" />
            <FormField id="tax-party-office" label={t('taxOffice')} required error={errors.taxOffice} size="m">
              <Input id="tax-party-office" value={taxOffice} onChange={(e) => setTaxOffice(e.target.value)} />
            </FormField>
            <FormField id="tax-party-number" label={t('taxNumber')} required error={errors.taxNumber} size="m">
              <Input id="tax-party-number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
            </FormField>
            <FormField id="tax-party-purpose" label={t('purpose')} required hint={t('purposeHint')} error={errors.beneficiaryPurpose} size="full">
              <Select id="tax-party-purpose" value={ao52PurposeOf(purpose) ? purpose : ''} onChange={(e) => setPurpose(e.target.value)}>
                <Ao52Options emptyLabel={t('purposeNone')} numberLabel={(n) => t('purposeNumber', { n })} />
              </Select>
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['taxOffice', 'taxNumber', 'beneficiaryPurpose'])} testId="tax-party-footer" />
      </DialogContent>
    </Dialog>
  );
}
