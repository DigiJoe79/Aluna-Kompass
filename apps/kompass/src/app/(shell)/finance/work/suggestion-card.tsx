'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { KeyChip } from '@/components/key-chip';
import { Notice } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { remediesFor, type Remedy } from '@/lib/finance/remedies';
import { miniFormFromSuggestion, miniFormToBookInput, type BookFromTransactionInput, type MiniFormState } from '@/lib/finance/work';
import { ruleFormFromTransaction, type RuleFormState } from '@/lib/finance/work-dialogs';
import type { EntryView } from '@kompass/module-finance';
import { savePartnerPaymentDraftAction } from '../partners/actions';
import { bookFromTransactionAction, linkTransactionAction } from './actions';
import { PartnerPaymentDialog, type WorkPartnerOption } from './partner-payment-dialog';
import { ContactDialog } from './contact-dialog';
import { ForeignDialog } from './foreign-dialog';
import { MiniEntryForm } from './mini-entry-form';
import { RuleDialog } from './rule-dialog';
import { VoucherPanel } from './voucher-panel';
import type { WorkDetailData, WorkFormOptions } from './work-detail';

/**
 * Die Vorschlagskarte (HANDOFF § 12.1, Baustein 13): die Begründungszeile im
 * Agenten-Ton mit dem festen Anfang „Vorschlag, weil:“, darunter die
 * Mini-Maske — oder, wenn der Umsatz zu einer vorhandenen Buchung passt,
 * „Verknüpfen“ statt neu buchen —, darunter die Aktionen mit ihren Tasten.
 * Ob ein Vorschlag sich buchen lässt, entscheidet der Dienst; die Karte zeigt
 * seine Probleme vorab und seine Ablehnung mit Ausweg.
 */
export function SuggestionCard({
  detail,
  canWrite,
  form,
  acceptRef,
  onDone,
  onSkip,
  onReload,
}: {
  detail: WorkDetailData;
  canWrite: boolean;
  form: WorkFormOptions;
  acceptRef: MutableRefObject<(() => void) | null>;
  onDone: (rawId: string) => void;
  onSkip: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('finance.work');
  // `remediesFor` liefert vollqualifizierte Schlüssel (`finance.remedy.*`).
  const tRoot = useTranslations();
  const { date } = useDateFormat();
  const [pending, startTransition] = useTransition();
  const raw = detail.raw;
  const suggestion = detail.suggestion;
  const [mini, setMini] = useState<MiniFormState>(() => miniFormFromSuggestion(raw, suggestion?.draft ?? null, new Map(Object.entries(detail.contactNames))));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const linkEntry = suggestion?.kind === 'linkEntry' ? suggestion.linkEntry : null;
  const [dialog, setDialog] = useState<'rule' | 'foreign' | 'contact' | 'partner' | null>(null);
  const [partnerError, setPartnerError] = useState<ActionState>({ status: 'idle' });
  const router = useRouter();
  const [ruleInitial, setRuleInitial] = useState<RuleFormState | null>(null);

  const openRule = () => {
    setRuleInitial(ruleFormFromTransaction(raw, linkEntry ? null : mini));
    setDialog('rule');
  };

  /** Für „Verknüpfen“ eines Belegs ohne vorhandenen Entwurf: die Mini-Maske, so weit sie lesbar ist — sonst nur die Geldzeile. */
  const draftForLink = (): Omit<BookFromTransactionInput, 'reviewed'> => {
    const built = linkEntry ? null : miniFormToBookInput(mini, raw.id, suggestion?.draft ?? null);
    if (built?.ok) {
      const { reviewed: _reviewed, ...rest } = built.input;
      return rest;
    }
    return { rawTransactionId: raw.id, entryDate: mini.entryDate || raw.bookingDate, text: mini.text.trim() || raw.purpose || raw.bookingDate, allocationLines: [] };
  };

  const finish = (result: ActionState) => {
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      setRefusal(null);
      onDone(raw.id);
    } else if (result.status === 'error') {
      setRefusal(result);
    }
  };

  const accept = () => {
    if (pending) return;
    if (linkEntry) {
      startTransition(async () => finish(await linkTransactionAction(raw.id, linkEntry.entryId)));
      return;
    }
    const built = miniFormToBookInput(mini, raw.id, suggestion?.draft ?? null);
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      setRefusal({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: {} });
      return;
    }
    setFieldErrors({});
    setRefusal(null);
    startTransition(async () => finish(await bookFromTransactionAction(built.input, detail.pendingInvoice?.documentId)));
  };
  /**
   * Task 5 (Design-Nachtrag Phase 4): die Mini-Maske auf den Partner buchen (geprüft, wie „Übernehmen“),
   * dann eine nachträgliche Zahlung an Partner mit der ausgehenden Zeile anlegen und in E2 springen.
   */
  const recordAsPartnerPayment = (partner: WorkPartnerOption) => {
    const built = miniFormToBookInput(mini, raw.id, suggestion?.draft ?? null);
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      setDialog(null);
      setRefusal({ status: 'error', message: t('toast.fieldsInvalid'), fieldErrors: {} });
      return;
    }
    setPartnerError({ status: 'idle' });
    startTransition(async () => {
      const input = { ...built.input, allocationLines: built.input.allocationLines.map((l) => ({ ...l, contactId: partner.contactId })) };
      const booked = await bookFromTransactionAction(input);
      if (booked.status !== 'success') {
        setPartnerError(booked);
        return;
      }
      const entry = booked.data as EntryView;
      const line = entry.allocationLines.find((l) => l.amountCents < 0 && l.contactId === partner.contactId);
      if (!line) {
        setPartnerError({ status: 'error', message: t('partnerPayment.noLine'), fieldErrors: {} });
        return;
      }
      const draft = await savePartnerPaymentDraftAction({ partnerId: partner.id, basis: partner.usualBasis ?? 'transfer58', purposeText: mini.text.trim() || raw.purpose || '', retroactive: true, positions: [], paidLineIds: [line.id] });
      if (draft.status !== 'success') {
        setPartnerError(draft);
        return;
      }
      const data = draft.data as { id: string };
      router.push(`/finance/partners/${partner.id}/payments/${data.id}`);
    });
  };

  // Enter in der Liste ruft, was hier der primäre Knopf tut — nach jedem Render mit dem aktuellen Stand der Maske.
  useEffect(() => {
    acceptRef.current = canWrite ? accept : null;
  });

  const remedyProps = (remedy: Remedy) => ({
    label: tRoot(remedy.labelKey),
    ...(remedy.kind === 'action' ? { onSelect: () => remedy.action === 'reloadWork' && onReload() } : { href: remedy.href }),
  });

  return (
    <>
    <section className="space-y-3 rounded-md border border-line bg-surface p-4">
      {suggestion && suggestion.kind !== 'none' ? (
        <div data-testid="suggestion-reasons" className="rounded-md bg-agent-bg px-3 py-2 text-[13px] text-agent">
          <p className="flex items-center gap-2 font-semibold">
            {t('suggestion.because')}
            {suggestion.confidence === 'unsure' ? <StatusBadge tone="warning">{t('suggestion.unsure')}</StatusBadge> : null}
            {suggestion.confidence === 'possible' ? <StatusBadge tone="warning">{t('suggestion.possible')}</StatusBadge> : null}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {suggestion.reasonTexts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('suggestion.none')}</p>
      )}

      {suggestion?.problems.map((problem) => (
        <Notice key={problem} level="refuse" remedies={problem === 'categoryInactive' ? remediesFor('categoryInactive').map(remedyProps) : undefined}>
          {t(`suggestion.problems.${problem}`)}
        </Notice>
      ))}
      {suggestion?.hints.includes('foreignIban') ? <p className="text-[12px] text-muted-ink">{t('suggestion.foreignIban')}</p> : null}
      {suggestion?.hints.includes('originIsDraft') ? (
        <p className="text-[12px] text-muted-ink" data-testid="suggestion-origin-draft">
          {t('suggestion.originIsDraft')}
        </p>
      ) : null}
      {detail.pendingInvoice && !linkEntry && canWrite ? (
        <div data-testid="pending-invoice">
          <Notice level="hint">{t('invoice.pending', { number: detail.pendingInvoice.number, seller: detail.pendingInvoice.seller })}</Notice>
        </div>
      ) : null}

      {linkEntry ? (
        <div className="space-y-2">
          <p className="text-[13px] text-ink">
            {linkEntry.number ? t('suggestion.linkEntry', { number: linkEntry.number, date: date(linkEntry.entryDate) }) : t('suggestion.linkDraft', { date: date(linkEntry.entryDate) })}
          </p>
          <Link href={`/finance/entries/${linkEntry.entryId}`} className="text-[13px] font-semibold underline underline-offset-2">
            {t('suggestion.openEntry')}
          </Link>
        </div>
      ) : canWrite ? (
        <MiniEntryForm value={mini} onChange={setMini} form={form} extraLineTexts={suggestion?.extraLineTexts ?? []} fieldErrors={fieldErrors} />
      ) : (
        <ul className="space-y-1 text-[13px] text-ink-2">
          {suggestion?.extraLineTexts.map((text) => <li key={text}>{text}</li>)}
          {mini.rows
            .filter((r) => r.categoryId)
            .map((r) => (
              <li key={r.key}>{t('suggestion.summaryLine', { category: form.categoryNames[r.categoryId] ?? '', amount: formatEuro((parseAmount(r.amountText) ?? 0) * mini.sign) })}</li>
            ))}
        </ul>
      )}

      {refusal ? (
        <Notice level="refuse" remedies={remediesFor(refusal.code ?? '').map(remedyProps)}>
          {refusal.detail ?? refusal.message}
        </Notice>
      ) : null}

      {canWrite ? (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {linkEntry ? (
              <Button type="button" onClick={accept} disabled={pending}>
                {t('suggestion.link')}
                <KeyChip className="ml-1">{t('keys.enterKey')}</KeyChip>
              </Button>
            ) : (
              <Button type="button" onClick={accept} disabled={pending}>
                {t('actions.accept')}
                <KeyChip className="ml-1">{t('keys.enterKey')}</KeyChip>
              </Button>
            )}
            <Link href={`/finance/entries/new?raw=${raw.id}&back=work`} className="inline-flex h-[var(--field-h)] items-center gap-1.5 rounded-md bg-surface-2 px-3.5 text-[13px] font-medium text-ink-2">
              {t('actions.edit')}
              <KeyChip>E</KeyChip>
            </Link>
            <Button type="button" variant="ghost" onClick={onSkip}>
              {t('actions.skip')}
              <KeyChip label={t('keys.right')}>→</KeyChip>
            </Button>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Button type="button" variant="link" className="h-auto p-0" onClick={openRule}>
              {t('actions.rule')}
            </Button>
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => setDialog('foreign')}>
              {t('actions.foreign')}
            </Button>
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => setDialog('contact')}>
              {t('actions.createContact')}
            </Button>
            {raw.amountCents < 0 ? (
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => setDialog('partner')}>
                {t('actions.partner')}
              </Button>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-muted-ink">{t('suggestion.readOnly')}</p>
      )}
    </section>
    {canWrite ? (
      <>
        <VoucherPanel raw={raw} voucherTypes={form.voucherTypes} draftForLink={draftForLink} entryTextIfNew={mini.text} onDone={onDone} />
        {ruleInitial ? <RuleDialog open={dialog === 'rule'} onOpenChange={(open) => setDialog(open ? 'rule' : null)} initial={ruleInitial} mode="create" options={form.rule} onSaved={onReload} /> : null}
        <ForeignDialog open={dialog === 'foreign'} onOpenChange={(open) => setDialog(open ? 'foreign' : null)} rawTransactionId={raw.id} outgoing={raw.amountCents < 0} returnOptions={detail.foreignReturnOptions} onDone={() => onDone(raw.id)} />
        <PartnerPaymentDialog open={dialog === 'partner'} onOpenChange={(open) => setDialog(open ? 'partner' : null)} partners={form.partners} state={partnerError} pending={pending} onConfirm={recordAsPartnerPayment} />
        <ContactDialog
          open={dialog === 'contact'}
          onOpenChange={(open) => setDialog(open ? 'contact' : null)}
          rawTransactionId={raw.id}
          counterpartyName={raw.counterpartyName}
          canCreate={form.canCreateContact}
          grantNames={form.contactGrantNames}
          onDone={onReload}
        />
      </>
    ) : null}
    </>
  );
}
