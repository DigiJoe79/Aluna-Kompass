'use client';

import type { ContactTaxDetails } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ao52PurposeOf } from '@kompass/module-finance/format';
import { Ao52Options } from '@/lib/finance/ao52-options';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveContactTaxDetailsAction } from '../../tax/actions';

/**
 * „Steuerdaten“ im Partnerprofil (Board 15g C): Finanzamt, Steuernummer und begünstigter Zweck der Körperschaft — für
 * Vermögensausstattungen in der Anlage Gem (Zeilen 65 und 70). Gespeichert am Kontakt, darum dieselben Angaben, die
 * die Steuererklärung bei einer Lücke abfragt. Der begünstigte Zweck ist Text wie im Bescheid des Partners, keine Auswahl.
 */
export function TaxDetailsCard({ contactId, details, canWrite }: { contactId: string; details: ContactTaxDetails | null; canWrite: boolean }) {
  const t = useTranslations('finance.partners.taxDetails');
  const router = useRouter();
  const initial = { taxOffice: details?.taxOffice ?? '', taxNumber: details?.taxNumber ?? '', purpose: details?.beneficiaryPurpose ?? '' };
  const [v, setV] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = (['taxOffice', 'taxNumber', 'purpose'] as const).filter((k) => v[k] !== baseline[k]).length;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => saveContactTaxDetailsAction({ contactId, taxOffice: v.taxOffice, taxNumber: v.taxNumber, beneficiaryPurpose: v.purpose }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    setBaseline(v);
    router.refresh();
  };

  const body = (
    <FormCardBody>
      <Section title={t('title')} intro={t('intro')}>
        <FormGrid>
          {canWrite ? (
            <>
              <FormField id="partner-tax-office" label={t('taxOffice')} error={errors.taxOffice} size="m">
                <Input id="partner-tax-office" value={v.taxOffice} onChange={(e) => setV({ ...v, taxOffice: e.target.value })} />
              </FormField>
              <FormField id="partner-tax-number" label={t('taxNumber')} error={errors.taxNumber} size="m">
                <Input id="partner-tax-number" value={v.taxNumber} onChange={(e) => setV({ ...v, taxNumber: e.target.value })} />
              </FormField>
              <FormField id="partner-tax-purpose" label={t('purpose')} hint={t('purposeHint')} error={errors.beneficiaryPurpose} size="l">
                <Select id="partner-tax-purpose" value={ao52PurposeOf(v.purpose) ? v.purpose : ''} onChange={(e) => setV({ ...v, purpose: e.target.value })}>
                  <Ao52Options emptyLabel={t('purposeNone')} numberLabel={(n) => t('purposeNumber', { n })} />
                </Select>
              </FormField>
            </>
          ) : (
            <>
              <FixedValue id="partner-tax-office" label={t('taxOffice')} value={v.taxOffice || null} reason={t('readOnly')} size="m" />
              <FixedValue id="partner-tax-number" label={t('taxNumber')} value={v.taxNumber || null} reason={t('readOnly')} size="m" />
              <FixedValue id="partner-tax-purpose" label={t('purpose')} value={ao52PurposeOf(v.purpose) ? `${t('purposeNumber', { n: ao52PurposeOf(v.purpose)!.number })} · ${ao52PurposeOf(v.purpose)!.text}` : null} reason={t('readOnly')} size="l" />
            </>
          )}
        </FormGrid>
      </Section>
    </FormCardBody>
  );
  if (!canWrite) return <FormCard as="section" data-testid="partner-tax-details">{body}</FormCard>;
  return (
    <FormCard
      as="form"
      data-testid="partner-tax-details"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      {body}
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(baseline)} pending={pending} state={withUnplacedFieldErrors(feedback.state, ['taxOffice', 'taxNumber', 'beneficiaryPurpose'])} saveTestId="partner-tax-save" />
    </FormCard>
  );
}
