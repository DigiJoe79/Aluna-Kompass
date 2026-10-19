'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FixedValue } from '@/components/fixed-value';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { createMemberAction } from '../actions';

export type FeeInterval = 'yearly' | 'halfYearly' | 'quarterly' | 'monthly';
export interface ScheduleOption {
  validFrom: string;
  rules: { typeId: string; amountCents: number; interval: FeeInterval }[];
}

/** Die Regel einer Art im Stand, der am Tag gilt — nur Anzeige; gerechnet wird im Dienst. */
export function ruleOn(schedules: readonly ScheduleOption[], typeId: string, day: string) {
  const schedule = [...schedules].filter((s) => s.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const rule = schedule?.rules.find((r) => r.typeId === typeId);
  return schedule && rule ? { ...rule, validFrom: schedule.validFrom } : null;
}

/**
 * „Mitglied anlegen“ (Handoff Mitglieder 2.2, 2a/2b): Person, Mitgliedschaft, Beitrag. Der Beitrag steht fest aus der
 * Beitragsordnung, „abweichend festlegen“ öffnet Betrag und Grund. Bei Lastschrift IBAN und Kontoinhaber — kein Feld
 * „Mandat“, das Mandat entsteht vorbereitet. Ohne Tag der Aufnahme ist es ein Antrag.
 */
export function MemberCreateForm({ types, schedules, initialContact, today }: { types: { id: string; name: string; exempt: boolean }[]; schedules: ScheduleOption[]; initialContact: PickedContact | null; today: string }) {
  const t = useTranslations('members.form');
  const ti = useTranslations('members.interval');
  const tp = useTranslations('members.payment');
  const c = useTranslations('common');
  const { date } = useDateFormat();
  const [contact, setContact] = useState<PickedContact | null>(initialContact);
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [appliedOn, setAppliedOn] = useState(today);
  const [admittedOn, setAdmittedOn] = useState('');
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState('');
  const [reduction, setReduction] = useState<'none' | 'reduced'>('none');
  const [payment, setPayment] = useState<'transfer' | 'directDebit'>('transfer');
  const [iban, setIban] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const type = types.find((ty) => ty.id === typeId);
  const rule = type && !type.exempt ? ruleOn(schedules, typeId, admittedOn || appliedOn) : null;

  const save = async () => {
    setPending(true);
    const amountCents = override && rule ? parseAmount(amount) : null;
    await feedback.run(
      () =>
        createMemberAction({
          contactId: contact?.id ?? '',
          typeId,
          appliedOn,
          admittedOn,
          paymentMethod: type?.exempt ? 'transfer' : payment,
          iban,
          debtorName: debtorName.trim() || contact?.name || '',
          amountCents: amountCents ?? null,
          reduction,
        }),
      { retry: () => void save() },
    );
    setPending(false);
  };

  const state = withUnplacedFieldErrors(feedback.state, ['contactId', 'typeId', 'appliedOn', 'admittedOn', 'amountCents', 'iban', 'debtorName']);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const changed = Number(contact !== initialContact) + Number(admittedOn !== '') + Number(override) + Number(payment !== 'transfer');

  return (
    // Als `<form>`, damit die Leiste die Pflichtfeld-Legende findet (MUSTER § B); gespeichert wird über `onSave`.
    <FormCard as="form" data-testid="member-create-form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}>
      <FormCardBody>
        <Section title={t('person')}>
          <FormGrid>
            <FormCell size="m">
              <ContactPicker id="member-contact" name="contactId" label={t('contact')} value={contact} onChange={setContact} canCreate required hint={t('contactHint')} />
              <FieldError id="member-contact-error" message={errors.contactId} />
            </FormCell>
            <FixedValue id="member-number" label={t('number')} value={null} reason={t('numberReason')} />
          </FormGrid>
        </Section>
        <Section title={t('membership')}>
          <FormGrid>
            <FormField id="member-type" label={t('type')} required error={errors.typeId}>
              <Select id="member-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>{ty.name}</option>
                ))}
              </Select>
            </FormField>
            <FormField id="member-applied" label={t('appliedOn')} required size="s" error={errors.appliedOn}>
              <Input id="member-applied" type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} />
            </FormField>
            <FormField id="member-admitted" label={t('admittedOn')} size="s" hint={t('admittedOnHint')} error={errors.admittedOn}>
              <Input id="member-admitted" type="date" value={admittedOn} onChange={(e) => setAdmittedOn(e.target.value)} />
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('fee')}>
          <FormGrid>
            {type?.exempt ? (
              <FixedValue id="member-fee" label={t('fee')} value={t('feeExempt')} reason={t('feeExemptReason')} />
            ) : !rule ? (
              <FixedValue id="member-fee" label={t('fee')} value={null} reason={t('feeNoRule')} />
            ) : override ? (
              <>
                <FormField id="member-amount" label={t('amount', { interval: ti(rule.interval) })} required size="s" error={errors.amountCents}>
                  <AmountField id="member-amount" name="amount" value={amount} onChange={setAmount} />
                </FormField>
                <FormField id="member-reduction" label={t('reduction')} hint={t('reductionHint')}>
                  <Select id="member-reduction" value={reduction} onChange={(e) => setReduction(e.target.value as 'none' | 'reduced')}>
                    <option value="none">{t('reductionNone')}</option>
                    <option value="reduced">{t('reductionReduced')}</option>
                  </Select>
                </FormField>
                <FormCell size="s" className="self-end">
                  <Button type="button" variant="link" className="h-auto p-0 underline" onClick={() => setOverride(false)}>{t('feeOverrideUndo')}</Button>
                </FormCell>
              </>
            ) : (
              <FixedValue
                id="member-fee"
                label={t('fee')}
                value={t('feeValue', { amount: formatEuro(rule.amountCents), interval: ti(rule.interval) })}
                reason={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {t('feeFromSchedule', { date: date(rule.validFrom) })}
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 underline" onClick={() => { setOverride(true); setAmount(''); }}>{t('feeOverride')}</Button>
                  </span>
                }
              />
            )}
            {type?.exempt ? null : (
              <FormField id="member-payment" label={t('payment')}>
                <Segmented
                  className="self-start"
                  aria-label={t('payment')}
                  value={payment}
                  onValueChange={setPayment}
                  options={[
                    { value: 'transfer', label: tp('transfer') },
                    { value: 'directDebit', label: tp('directDebit') },
                  ]}
                />
              </FormField>
            )}
            {!type?.exempt && payment === 'directDebit' ? (
              <>
                <FormField id="member-iban" label={t('iban')} required error={errors.iban}>
                  <Input id="member-iban" value={iban} onChange={(e) => setIban(e.target.value)} autoComplete="off" spellCheck={false} />
                </FormField>
                <FormField id="member-debtor" label={t('debtorName')} hint={t('debtorNameHint')} error={errors.debtorName}>
                  <Input id="member-debtor" value={debtorName} placeholder={contact?.name ?? ''} onChange={(e) => setDebtorName(e.target.value)} />
                </FormField>
              </>
            ) : null}
          </FormGrid>
        </Section>
      </FormCardBody>
      <FormActionBar mode="create" back={{ href: '/members', label: c('backToList') }} state={state} count={changed} onSave={() => void save()} pending={pending} testId="member-create-footer" />
    </FormCard>
  );
}
