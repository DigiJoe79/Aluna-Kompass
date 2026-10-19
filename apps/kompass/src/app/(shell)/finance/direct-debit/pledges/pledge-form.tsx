'use client';

import { compactIban } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { AmountField } from '@/components/finance/amount-field';
import { FixedValue } from '@/components/fixed-value';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { formatAmount, parseAmount } from '@/lib/finance/amount';
import { savePledgeAction } from '../actions';

type Interval = 'monthly' | 'quarterly' | 'halfYearly' | 'yearly';
type Method = 'directDebit' | 'transfer' | 'standingOrder';
const INTERVALS: readonly Interval[] = ['monthly', 'quarterly', 'halfYearly', 'yearly'];
const METHODS: readonly Method[] = ['transfer', 'directDebit', 'standingOrder'];

export interface PledgeFormValues {
  id?: string;
  contact: PickedContact | null;
  amountCents: number | null;
  interval: Interval;
  firstDueOn: string;
  lastDueOn: string;
  binding: string;
  paymentMethod: Method;
  note: string | null;
  mandate: { id: string; reference: string; state: 'pending' | 'active' | 'ended' | 'expired' } | null;
}

/**
 * Zusage (Handoff 2a § 1.5, 15a/15b): Stammdaten als eine Formularkarte. Die Spenderin ist nach dem Anlegen fest („am
 * Kontakt pflegen“); bei Lastschrift ohne nutzbares Mandat nimmt die Maske IBAN und Kontoinhaber auf — gespeichert
 * liegen dann das Mandat vorbereitet und die Ankündigung als Entwurf bereit (`savePledge`).
 */
export function PledgeForm({ initial, bindings, canEdit }: { initial: PledgeFormValues; bindings: { value: string; label: string }[]; canEdit: boolean }) {
  const t = useTranslations('finance.directDebit.pledge');
  const ts = useTranslations('finance.directDebit.states');
  const router = useRouter();
  const create = !initial.id;
  const [contact, setContact] = useState(initial.contact);
  const [amount, setAmount] = useState(initial.amountCents === null ? '' : formatAmount(initial.amountCents));
  const [interval, setInterval] = useState<Interval>(initial.interval);
  const [firstDueOn, setFirstDueOn] = useState(initial.firstDueOn);
  const [lastDueOn, setLastDueOn] = useState(initial.lastDueOn);
  const [binding, setBinding] = useState(initial.binding);
  const [method, setMethod] = useState<Method>(initial.paymentMethod);
  const [iban, setIban] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const usableMandate = initial.mandate && (initial.mandate.state === 'pending' || initial.mandate.state === 'active') ? initial.mandate : null;
  const needsMandate = method === 'directDebit' && !usableMandate;
  const state = withUnplacedFieldErrors(feedback.state, ['contactId', 'amountCents', 'interval', 'firstDueOn', 'lastDueOn', 'iban', 'debtorName']);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const changed =
    Number(contact?.id !== initial.contact?.id) +
    Number(amount !== (initial.amountCents === null ? '' : formatAmount(initial.amountCents))) +
    Number(interval !== initial.interval) +
    Number(firstDueOn !== initial.firstDueOn) +
    Number(lastDueOn !== initial.lastDueOn) +
    Number(binding !== initial.binding) +
    Number(method !== initial.paymentMethod) +
    Number(iban !== '' || debtorName !== '');

  const reset = () => {
    setContact(initial.contact);
    setAmount(initial.amountCents === null ? '' : formatAmount(initial.amountCents));
    setInterval(initial.interval);
    setFirstDueOn(initial.firstDueOn);
    setLastDueOn(initial.lastDueOn);
    setBinding(initial.binding);
    setMethod(initial.paymentMethod);
    setIban('');
    setDebtorName('');
  };

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        savePledgeAction({
          ...(initial.id ? { id: initial.id } : {}),
          contactId: contact?.id ?? '',
          amountCents: parseAmount(amount) ?? 0,
          interval,
          firstDueOn,
          lastDueOn: lastDueOn || null,
          paymentMethod: method,
          purposeId: binding.startsWith('purpose:') ? binding.slice(8) : null,
          projectId: binding.startsWith('project:') ? binding.slice(8) : null,
          note: initial.note,
          ...(method === 'directDebit' && usableMandate ? { mandateId: usableMandate.id } : {}),
          ...(needsMandate ? { iban: compactIban(iban), debtorName: debtorName.trim() || contact?.name || '' } : {}),
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    if (create) router.push(`/finance/direct-debit/pledges/${(result.data as { id: string }).id}`);
    else router.refresh();
  };

  return (
    <FormCard as="form" data-testid="pledge-form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}>
      <FormCardBody>
        <Section title={t('pledge')}>
          <FormGrid>
            {create ? (
              <FormCell size="m">
                <ContactPicker id="pledge-contact" name="contactId" label={t('donor')} value={contact} onChange={setContact} canCreate required />
                <FieldError id="pledge-contact-error" message={errors.contactId} />
              </FormCell>
            ) : (
              <FixedValue
                id="pledge-contact"
                label={t('donor')}
                value={initial.contact?.name ?? null}
                reason={initial.contact ? <Link href={`/contacts/${initial.contact.id}`} className="text-link underline underline-offset-2">{t('donorReason')}</Link> : undefined}
              />
            )}
            <FormField id="pledge-amount" label={t('amount')} required size="s" error={errors.amountCents}>
              <AmountField id="pledge-amount" name="amount" value={amount} onChange={setAmount} />
            </FormField>
            <FormField id="pledge-interval" label={t('interval')} required size="s" error={errors.interval}>
              <Select id="pledge-interval" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
                {INTERVALS.map((i) => (
                  <option key={i} value={i}>{t(`intervals.${i}`)}</option>
                ))}
              </Select>
            </FormField>
            <FormField id="pledge-first" label={t('firstDueOn')} required size="s" error={errors.firstDueOn}>
              <Input id="pledge-first" type="date" value={firstDueOn} onChange={(e) => setFirstDueOn(e.target.value)} />
            </FormField>
            <FormField id="pledge-last" label={t('lastDueOn')} hint={t('lastDueOnHint')} size="s" error={errors.lastDueOn}>
              <Input id="pledge-last" type="date" value={lastDueOn} onChange={(e) => setLastDueOn(e.target.value)} />
            </FormField>
            <FormField id="pledge-binding" label={t('binding')} hint={t('bindingHint')} size="l">
              <Select id="pledge-binding" value={binding} onChange={(e) => setBinding(e.target.value)}>
                <option value="">{t('general')}</option>
                {bindings.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </Section>
        <Section title={t('payment')}>
          <FormGrid>
            <FormField id="pledge-method" label={t('method')} size="l">
              <Segmented className="self-start" aria-label={t('method')} value={method} onValueChange={(v) => setMethod(v as Method)} options={METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))} />
            </FormField>
            {method === 'directDebit' && usableMandate ? (
              <FixedValue
                id="pledge-mandate"
                label={t('mandate')}
                value={usableMandate.reference}
                mono
                reason={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge tone={statusTone('mandate', usableMandate.state)} dot>{ts(`mandate.${usableMandate.state}`)}</StatusBadge>
                    <Link href={`/finance/direct-debit/mandates/${usableMandate.id}`} className="text-link underline underline-offset-2">{t('openMandate')}</Link>
                  </span>
                }
              />
            ) : null}
            {needsMandate ? (
              <>
                <FormField id="pledge-iban" label={t('iban')} required error={errors.iban}>
                  <Input id="pledge-iban" value={iban} autoComplete="off" spellCheck={false} onChange={(e) => setIban(e.target.value)} />
                </FormField>
                <FormField id="pledge-debtor" label={t('debtorName')} hint={t('debtorNameHint')} error={errors.debtorName}>
                  <Input id="pledge-debtor" value={debtorName} maxLength={70} placeholder={contact?.name ?? ''} onChange={(e) => setDebtorName(e.target.value)} />
                </FormField>
              </>
            ) : null}
          </FormGrid>
        </Section>
      </FormCardBody>
      {canEdit ? (
        create ? (
          <FormActionBar mode="create" back={{ href: '/finance/direct-debit?view=pledges', label: t('backToList') }} state={state} count={changed} onSave={() => void save()} pending={pending} testId="pledge-create-footer" />
        ) : (
          <FormActionBar count={changed} onSave={() => void save()} onDiscard={reset} pending={pending} state={state} saveTestId="pledge-save" />
        )
      ) : null}
    </FormCard>
  );
}
