'use client';

import type { MemberFeeDetail } from '@kompass/module-members';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { previewRecalculationAction, saveMemberAction } from '../actions';

/** Was die Vorschau der Neuberechnung meldet; `transferKept`: Beiträge, die wegen eines Briefs Überweisung bleiben (Plan N1 E3). */
interface RecalcHint {
  replaced: number;
  kept: number;
  added: number;
  transferKept: number;
  transferLetterOn: string | null;
  /** R4: Beiträge, die ein Brief als Einzug angekündigt hat und die auf Überweisung wechseln. */
  debitAnnounced: number;
  debitLetterOn: string | null;
}

export interface MemberFormData {
  id: string;
  status: 'applied' | 'rejected' | 'active' | 'ending' | 'ended';
  contactId: string;
  contactName: string;
  memberNumber: string | null;
  appliedOn: string | null;
  admittedOn: string | null;
  typeId: string;
}

/**
 * Die Formularkarte des Mitglieds (Handoff Mitglieder D1, 3a/3c): Mitgliedschaft und Beitrag. Name und Anschrift
 * stehen fest (am Kontakt gepflegt), Nummer und Tage durch die Fachschritte. Art und Beitrag ändern sich ab einem Tag;
 * vor dem Speichern sagt ein Hinweis, welche angelegten Beiträge ersetzt werden (Spec § 3.3). Ohne `members.fees`
 * ist der Beitrag nur lesbar (Review Focus 2).
 */
export function MemberForm({ m, types, detail, canManage, canFees, canOpenMandate = false, today }: { m: MemberFormData; types: { id: string; name: string; exempt: boolean }[]; detail: MemberFeeDetail; canManage: boolean; canFees: boolean; canOpenMandate?: boolean; today: string }) {
  const t = useTranslations('members.detail');
  const tf = useTranslations('members.form');
  const ti = useTranslations('members.interval');
  const tp = useTranslations('members.payment');
  const tm = useTranslations('members.mandateState');
  const { date } = useDateFormat();
  const router = useRouter();
  const running = m.status === 'active' || m.status === 'ending';
  const editable = m.status === 'active' || m.status === 'ending' || m.status === 'applied';

  const [typeId, setTypeId] = useState(m.typeId);
  const [typeFrom, setTypeFrom] = useState(today);
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState('');
  const [reduction, setReduction] = useState<'none' | 'reduced'>(detail.reduction === 'reduced' ? 'reduced' : 'none');
  const [payment, setPayment] = useState(detail.paymentMethod);
  const [iban, setIban] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [feeFrom, setFeeFrom] = useState(m.status === 'applied' ? (m.appliedOn ?? today) : today);
  const [plan, setPlan] = useState<RecalcHint | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const typeChanged = running && typeId !== m.typeId;
  const feeChanged = override || payment !== detail.paymentMethod;
  const changed = Number(typeChanged) + Number(override) + Number(payment !== detail.paymentMethod);
  const amountCents = override ? parseAmount(amount) : null;
  const needsMandate = payment === 'directDebit' && (!detail.mandate || detail.mandate.state === 'ended' || detail.mandate.state === 'expired');

  // Vor dem Speichern (Spec § 3.3): was mit den angelegten Beiträgen geschähe. Nur für eine laufende Mitgliedschaft.
  useEffect(() => {
    if (!running || (!typeChanged && !feeChanged)) {
      setPlan(null);
      return;
    }
    const from = typeChanged ? typeFrom : feeFrom;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    const change = typeChanged
      ? { kind: 'type' as const, typeId }
      : { kind: 'agreement' as const, paymentMethod: payment, ...(amountCents !== null ? { amountCents, reduction } : {}) };
    let current = true;
    void previewRecalculationAction({ membershipId: m.id, from, change }).then((result) => {
      if (current && result.status === 'success') setPlan(result.data as RecalcHint);
    });
    return () => {
      current = false;
    };
  }, [running, typeChanged, feeChanged, typeId, typeFrom, feeFrom, payment, amountCents, reduction, m.id]);

  const discard = () => {
    setTypeId(m.typeId);
    setOverride(false);
    setAmount('');
    setPayment(detail.paymentMethod);
    setIban('');
    setDebtorName('');
  };

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveMemberAction({
          membershipId: m.id,
          type: typeChanged ? { typeId, validFrom: typeFrom } : null,
          agreement: feeChanged ? { validFrom: feeFrom, paymentMethod: payment, amountCents, reduction, iban, debtorName: debtorName.trim() || m.contactName } : null,
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    discard();
    router.refresh();
  };

  const state = withUnplacedFieldErrors(feedback.state, ['typeId', 'validFrom', 'amountCents', 'iban', 'debtorName']);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const type = types.find((ty) => ty.id === typeId);
  const fee = detail.fee;
  const feeValue = fee.kind === 'exempt' ? tf('feeExempt') : fee.kind === 'fee' ? tf('feeValue', { amount: formatEuro(fee.amountCents), interval: ti(fee.interval) }) : null;
  const feeReason =
    fee.kind === 'exempt'
      ? t('feeExemptReason')
      : fee.kind === 'none'
        ? t('feeNoRule')
        : fee.source === 'agreement' && detail.agreementFrom
          ? detail.reduction === 'reduced'
            ? t('feeReduced', { date: date(detail.agreementFrom) })
            : t('feeFromAgreement', { date: date(detail.agreementFrom) })
          : fee.scheduleValidFrom
            ? t('feeFromSchedule', { date: date(fee.scheduleValidFrom) })
            : t('feeNoRule');
  const canEditFee = canFees && editable && fee.kind === 'fee';

  return (
    <FormCard as="form" data-testid="member-form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void save(); }}>
      <FormCardBody>
        <Section title={t('membership')}>
          <FormGrid>
            <FixedValue id="member-contact" label={t('contact')} value={m.contactName} href={`/contacts/${m.contactId}`} reason={t('contactReason')} />
            <FixedValue id="member-number" label={t('number')} value={m.memberNumber} reason={m.memberNumber ? t('numberAdmitted') : t('numberApplied')} />
            {running && canManage ? (
              <FormField id="member-type" label={t('type')} required error={errors.typeId}>
                <Select id="member-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  {types.map((ty) => (
                    <option key={ty.id} value={ty.id}>{ty.name}</option>
                  ))}
                </Select>
              </FormField>
            ) : (
              <FixedValue id="member-type" label={t('type')} value={types.find((ty) => ty.id === m.typeId)?.name ?? null} reason={m.status === 'applied' ? t('typeApplied') : t('admittedReason')} />
            )}
            {typeChanged ? (
              <FormField id="member-type-from" label={t('typeFrom')} required size="s" error={errors.validFrom}>
                <Input id="member-type-from" type="date" value={typeFrom} onChange={(e) => setTypeFrom(e.target.value)} />
              </FormField>
            ) : null}
            <FixedValue id="member-applied" label={t('appliedOn')} value={m.appliedOn ? date(m.appliedOn) : null} reason={t('appliedReason')} size="s" />
            <FixedValue id="member-admitted" label={t('admittedOn')} value={m.admittedOn ? date(m.admittedOn) : null} reason={m.admittedOn ? t('admittedReason') : t('admittedPending')} size="s" />
          </FormGrid>
        </Section>
        <Section title={t('fee')}>
          <FormGrid>
            {override && fee.kind === 'fee' ? (
              <>
                <FormField id="member-amount" label={tf('amount', { interval: ti(fee.interval) })} required size="s" error={errors.amountCents}>
                  <AmountField id="member-amount" name="amount" value={amount} onChange={setAmount} />
                </FormField>
                <FormField id="member-reduction" label={tf('reduction')} hint={tf('reductionHint')}>
                  <Select id="member-reduction" value={reduction} onChange={(e) => setReduction(e.target.value as 'none' | 'reduced')}>
                    <option value="none">{tf('reductionNone')}</option>
                    <option value="reduced">{tf('reductionReduced')}</option>
                  </Select>
                </FormField>
                <FormCell size="s" className="self-end">
                  <Button type="button" variant="link" className="h-auto p-0 underline" onClick={() => setOverride(false)}>{tf('feeOverrideUndo')}</Button>
                </FormCell>
              </>
            ) : (
              <FixedValue
                id="member-fee"
                label={t('fee')}
                value={feeValue}
                reason={
                  canEditFee ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {feeReason}
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 underline" onClick={() => { setOverride(true); setAmount(fee.kind === 'fee' ? formatAmount(fee.amountCents) : ''); }}>{tf('feeOverride')}</Button>
                    </span>
                  ) : (
                    feeReason
                  )
                }
              />
            )}
            {fee.kind === 'exempt' ? null : canFees && editable ? (
              <FormField id="member-payment" label={t('payment')}>
                <Segmented className="self-start" aria-label={t('payment')} value={payment} onValueChange={setPayment} options={[{ value: 'transfer', label: tp('transfer') }, { value: 'directDebit', label: tp('directDebit') }]} />
              </FormField>
            ) : (
              <FixedValue id="member-payment" label={t('payment')} value={tp(detail.paymentMethod)} reason={t('paymentReason')} />
            )}
            {payment === 'directDebit' && detail.mandate && !needsMandate ? (
              <FixedValue
                id="member-mandate"
                label={t('mandate')}
                value={detail.mandate.reference}
                // Die Mandatsseite liest, wer Finanzen lesen darf (Plan U2).
                href={canOpenMandate ? `/finance/direct-debit/mandates/${detail.mandate.id}` : undefined}
                mono
                reason={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {detail.mandate.state === 'active' ? null : <StatusBadge tone={statusTone('mandate', detail.mandate.state)} dot>{tm(detail.mandate.state)}</StatusBadge>}
                    {t('mandateReason')}
                  </span>
                }
              />
            ) : null}
            {canFees && needsMandate ? (
              <>
                <FormField id="member-iban" label={tf('iban')} required error={errors.iban}>
                  <Input id="member-iban" value={iban} onChange={(e) => setIban(e.target.value)} autoComplete="off" spellCheck={false} />
                </FormField>
                <FormField id="member-debtor" label={tf('debtorName')} hint={tf('debtorNameHint')} error={errors.debtorName}>
                  <Input id="member-debtor" value={debtorName} placeholder={m.contactName} onChange={(e) => setDebtorName(e.target.value)} />
                </FormField>
              </>
            ) : null}
            {feeChanged ? (
              <FormField id="member-fee-from" label={t('feeFrom')} required size="s" error={errors.validFrom}>
                <Input id="member-fee-from" type="date" value={feeFrom} onChange={(e) => setFeeFrom(e.target.value)} />
              </FormField>
            ) : null}
          </FormGrid>
          {plan && (plan.replaced > 0 || plan.kept > 0 || plan.added > 0 || plan.transferKept > 0 || plan.debitAnnounced > 0) ? (
            <div className="mt-4">
              <Notice level="hint" testId="member-recalc">
                {[plan.replaced > 0 ? t('recalc', { count: plan.replaced }) : null, plan.kept > 0 ? t('recalcKept', { count: plan.kept }) : null, plan.added > 0 ? t('recalcNew', { count: plan.added }) : null, plan.transferKept > 0 && plan.transferLetterOn ? t('recalcTransferKept', { count: plan.transferKept, date: date(plan.transferLetterOn) }) : null, plan.debitAnnounced > 0 && plan.debitLetterOn ? t('recalcDebitAnnounced', { count: plan.debitAnnounced, date: date(plan.debitLetterOn) }) : null].filter(Boolean).join(' ')}
              </Notice>
            </div>
          ) : null}
        </Section>
      </FormCardBody>
      {type && editable && (canManage || canFees) ? (
        <FormActionBar count={changed} onSave={() => void save()} onDiscard={discard} pending={pending} state={state} saveTestId="member-save" />
      ) : null}
    </FormCard>
  );
}
