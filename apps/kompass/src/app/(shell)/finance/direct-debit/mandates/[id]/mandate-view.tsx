'use client';

import { compactIban, formatIban, maskIban } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Steps, type Step } from '@/components/steps';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { amendMandateAction, correctMandateAction, endMandateAction, fileSignedMandateAction, mandateFormAction } from '../../actions';

type MandateState = 'pending' | 'active' | 'ended' | 'expired';

export interface MandateViewProps {
  back: { href: string; label: string };
  mandate: {
    id: string;
    reference: string;
    state: MandateState;
    payer: string;
    contactId: string;
    debtorName: string;
    iban: string;
    sequence: 'recurring' | 'oneOff';
    preparedOn: string;
    signedOn: string | null;
    signedNumber: string | null;
    endedOn: string | null;
    lastCollectedOn: string | null;
    expiresOn: string | null;
  };
  usages: { kind: 'membership' | 'pledge'; href: string | null }[];
  creditorId: string | null;
  changes: { id: string; field: 'iban' | 'bic' | 'debtorName'; before: string | null; after: string | null; validFrom: string; createdAt: string }[];
  collections: { runId: string; collectionDate: string; source: 'openItem' | 'pledge'; installmentOn: string | null; remittance: string; amountCents: number }[];
  returns: { id: string; runId: string; collectionDate: string; returnedOn: string; returnCode: string | null; amountCents: number; status: 'open' | 'resolved' }[];
  today: string;
  canPrepare: boolean;
}

/**
 * Mandat (Handoff 2a § 1.4, D6): Vorgang in einer Spalte. Im Kopf ein Knopf — vor der Unterschrift „Korrigieren“,
 * danach „Änderung erfassen …“ —, ⋯ „Mandat beenden …“. Zwei kompakte Schritte „Bis zum ersten Einzug“: Formular
 * öffnen (PDF), Unterschrift ablegen (Ablagefläche, Tag der Unterschrift im Dialog → aktiv). „Angaben“ als feste Werte,
 * darunter Änderungen, Einzüge, Rückgaben; eine leere Nebenliste entfällt.
 */
export function MandateView({ back, mandate: m, usages, creditorId, changes, collections, returns, today, canPrepare }: MandateViewProps) {
  const t = useTranslations('finance.directDebit.mandate');
  const ts = useTranslations('finance.directDebit.states');
  const tl = useTranslations('finance.directDebit.list');
  const tc = useTranslations('finance.directDebit.returnCodes');
  const { date } = useDateFormat();
  const router = useRouter();
  const menuRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<'correct' | 'amend' | 'end' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const formFb = useActionFeedback();
  const [opening, setOpening] = useState(false);
  const pending = m.state === 'pending';
  const running = m.state === 'pending' || m.state === 'active';

  const openForm = async () => {
    setOpening(true);
    const result = await formFb.run(() => mandateFormAction(m.id), { retry: () => void openForm() });
    setOpening(false);
    if (result.status !== 'success') return;
    // Das Formular liegt in der Akte; dorthin, wie bei der Bescheinigung der Mitgliederzahl. Kein `window.open` nach
    // einer asynchronen Aktion — das blockieren Safari und Popup-Blocker.
    const { documentId } = result.data as { documentId: string };
    router.push(`/dms/${documentId}`);
  };

  const usageText = usages.map((u) => t(`usage.${u.kind}`)).join(` ${t('and')} `);
  const steps: Step[] = [
    {
      key: 'sign',
      label: t('sign'),
      state: pending ? 'active' : 'done',
      detail: pending ? t('prefilled') : m.signedOn ? date(m.signedOn) : undefined,
      action: pending && canPrepare ? <Button type="button" variant="outline" onClick={() => void openForm()} disabled={opening} data-testid="mandate-open-form">{t('openForm')}</Button> : undefined,
      below: formFb.state.status === 'error' ? <RefusalNotice action state={formFb.state} /> : undefined,
    },
    {
      key: 'file',
      label: t('file'),
      state: pending ? 'todo' : 'done',
      detail: m.signedNumber ?? undefined,
      below: pending && canPrepare ? (
        <div className="max-w-md">
          <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} />
        </div>
      ) : undefined,
    },
  ];

  const header = (
    <PageHeader
      title={m.reference}
      description={[m.payer, usageText ? t('for', { usage: usageText }) : null, t('preparedOn', { date: date(m.preparedOn) })].filter(Boolean).join(' · ')}
      back={back}
      status={<StatusBadge tone={statusTone('mandate', m.state)} dot>{ts(`mandate.${m.state}`)}</StatusBadge>}
      actions={
        canPrepare && running ? (
          <>
            {pending ? (
              <Button type="button" onClick={() => setDialog('correct')} data-testid="mandate-correct">{t('correct')}</Button>
            ) : (
              <Button type="button" onClick={() => setDialog('amend')} data-testid="mandate-amend">{t('amend')}</Button>
            )}
            <RecordActions triggerRef={menuRef} testId="mandate-actions" actions={[{ key: 'end', label: t('end'), kind: 'undoing', onSelect: () => setDialog('end'), testId: 'mandate-end' }]} />
          </>
        ) : null
      }
    />
  );

  return (
    <Page width="task" header={header}>
      <div className="flex flex-col gap-5">
        {m.signedOn || pending ? (
          <section className="rounded-lg border border-line bg-surface p-5">
            <Section title={t('stepsTitle')}>
              <Steps density="compact" label={t('stepsTitle')} steps={steps} done={m.signedOn ? t('activeSince', { date: date(m.signedOn) }) : undefined} testId="mandate-steps" />
            </Section>
          </section>
        ) : null}

        <section className="rounded-lg border border-line bg-surface p-5">
          <Section title={t('details')} intro={<span id="mandate-details-reason">{t('detailsReason')}</span>}>
            <FormGrid>
              <FixedValue
                id="mandate-payer"
                label={t('payer')}
                describedBy="mandate-details-reason"
                value={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {m.payer}
                    {usages
                      .filter((u) => u.href)
                      .map((u, i) => (
                        <Link key={i} href={u.href!} className="text-meta text-link underline underline-offset-2">{t(`open.${u.kind}`)}</Link>
                      ))}
                  </span>
                }
              />
              <FixedValue id="mandate-debtor" label={t('debtorName')} value={m.debtorName} describedBy="mandate-details-reason" />
              <FixedValue id="mandate-iban" label={t('iban')} value={formatIban(m.iban)} mono describedBy="mandate-details-reason" />
              <FixedValue id="mandate-reference" label={t('reference')} value={m.reference} mono describedBy="mandate-details-reason" />
              <FixedValue id="mandate-creditor" label={t('creditorId')} value={creditorId} mono describedBy="mandate-details-reason" />
              <FixedValue id="mandate-kind" label={t('kind')} value={t(`sequence.${m.sequence}`)} describedBy="mandate-details-reason" />
              {m.state === 'active' && m.expiresOn ? (
                <FixedValue
                  id="mandate-last"
                  label={t('lastCollected')}
                  value={[m.lastCollectedOn ? date(m.lastCollectedOn) : t('notYet'), t('expires', { date: date(m.expiresOn) })].join(' · ')}
                  describedBy="mandate-details-reason"
                  size="full"
                />
              ) : null}
              {m.endedOn ? <FixedValue id="mandate-ended" label={t('endedOn')} value={date(m.endedOn)} describedBy="mandate-details-reason" /> : null}
            </FormGrid>
          </Section>
        </section>

        {changes.length > 0 ? (
          <Section title={t('changes')}>
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="title">{t('columns.changedOn')}</TableHead>
                    <TableHead>{t('columns.change')}</TableHead>
                    <TableHead col="meta">{t('columns.validFrom')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => {
                    const show = (value: string | null) => (value === null ? '' : c.field === 'iban' ? maskIban(value) : value);
                    return (
                      <TableRow key={c.id}>
                        <TableCell col="title">{date(c.createdAt)}</TableCell>
                        <TableCell className="text-ink-2">{t('changeText', { field: t(`fields.${c.field}`), before: show(c.before), after: show(c.after) })}</TableCell>
                        <TableCell col="meta" className="text-ink-2">{date(c.validFrom)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}

        {collections.length > 0 ? (
          <Section title={t('collections')}>
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="title">{t('columns.run')}</TableHead>
                    <TableHead>{t('columns.for')}</TableHead>
                    <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((c, i) => (
                    <TableRow key={`${c.runId}-${i}`}>
                      <TableCell col="title"><RowLink href={`/finance/direct-debit/runs/${c.runId}`}>{tl('runOn', { date: date(c.collectionDate) })}</RowLink></TableCell>
                      <TableCell className="text-ink-2">{c.installmentOn ? tl('rateOf', { date: date(c.installmentOn) }) : c.remittance}</TableCell>
                      <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(c.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}

        {returns.length > 0 ? (
          <Section title={t('returns')}>
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead col="title">{t('columns.run')}</TableHead>
                    <TableHead col="meta">{t('columns.returnedOn')}</TableHead>
                    <TableHead>{t('columns.reason')}</TableHead>
                    <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
                    <TableHead col="status">{t('columns.state')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell col="title"><RowLink href={`/finance/direct-debit/runs/${r.runId}`}>{tl('runOn', { date: date(r.collectionDate) })}</RowLink></TableCell>
                      <TableCell col="meta" className="text-ink-2">{date(r.returnedOn)}</TableCell>
                      <TableCell className="text-ink-2">{r.returnCode ? `${r.returnCode}, ${tc.has(r.returnCode) ? tc(r.returnCode) : tc('unknown', { code: r.returnCode })}` : null}</TableCell>
                      <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(r.amountCents)}</TableCell>
                      <TableCell col="status">{r.status === 'open' ? <StatusBadge tone={statusTone('debitReturn', 'open')} dot>{ts('return.open')}</StatusBadge> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        ) : null}
      </div>

      {file ? <SignDialog mandateId={m.id} file={file} today={today} onClose={() => setFile(null)} /> : null}
      {dialog === 'correct' || dialog === 'amend' ? <DetailsDialog mode={dialog} mandate={m} today={today} onClose={() => setDialog(null)} /> : null}
      {dialog === 'end' ? <EndDialog mandateId={m.id} today={today} finalFocus={menuRef} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

/** Ablage der Unterschrift (D6): Tag der Unterschrift, Vorgabe heute; „Ablegen“ setzt das Mandat aktiv. */
function SignDialog({ mandateId, file, today, onClose }: { mandateId: string; file: File; today: string; onClose: () => void }) {
  const t = useTranslations('finance.directDebit.mandate');
  const router = useRouter();
  const [signedOn, setSignedOn] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const formData = new FormData();
    formData.append('mandateId', mandateId);
    formData.append('signedOn', signedOn);
    formData.append('file', file);
    const result = await feedback.run(() => fileSignedMandateAction(formData), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="mandate-sign-dialog">
        <DialogHeader>
          <DialogTitle>{t('signTitle')}</DialogTitle>
          <DialogDescription>{t('signText', { file: file.name })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="mandate-signed-on" label={t('signedOn')} required size="s" error={errors.signedOn}>
              <Input id="mandate-signed-on" type="date" max={today} value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveDisabled={!signedOn} saveLabel={t('signSave')} onSave={() => void save()} state={feedback.state} testId="mandate-sign-footer" />
      </DialogContent>
    </Dialog>
  );
}

/** „Korrigieren“ vor der Unterschrift (am Mandat selbst) bzw. „Änderung erfassen …“ danach (mit „gilt ab“). */
function DetailsDialog({ mode, mandate, today, onClose }: { mode: 'correct' | 'amend'; mandate: MandateViewProps['mandate']; today: string; onClose: () => void }) {
  const t = useTranslations('finance.directDebit.mandate');
  const router = useRouter();
  const [debtorName, setDebtorName] = useState(mandate.debtorName);
  const [iban, setIban] = useState(mode === 'correct' ? formatIban(mandate.iban) : '');
  const [validFrom, setValidFrom] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        mode === 'correct'
          ? correctMandateAction({ mandateId: mandate.id, debtorName: debtorName.trim(), iban: compactIban(iban) })
          : amendMandateAction({ mandateId: mandate.id, validFrom, ...(iban.trim() ? { iban: compactIban(iban) } : {}), ...(debtorName.trim() !== mandate.debtorName ? { debtorName: debtorName.trim() } : {}) }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" data-testid="mandate-details-dialog">
        <DialogHeader>
          <DialogTitle>{t(mode === 'correct' ? 'correctTitle' : 'amendTitle')}</DialogTitle>
          <DialogDescription>{t(mode === 'correct' ? 'correctText' : 'amendText')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="mandate-debtor-name" label={t('debtorName')} required error={errors.debtorName}>
              <Input id="mandate-debtor-name" value={debtorName} maxLength={70} onChange={(e) => setDebtorName(e.target.value)} />
            </FormField>
            <FormField id="mandate-new-iban" label={t(mode === 'correct' ? 'iban' : 'newIban')} required={mode === 'correct'} hint={mode === 'amend' ? t('newIbanHint') : undefined} error={errors.iban}>
              <Input id="mandate-new-iban" value={iban} autoComplete="off" spellCheck={false} onChange={(e) => setIban(e.target.value)} />
            </FormField>
            {mode === 'amend' ? (
              <FormField id="mandate-valid-from" label={t('validFrom')} hint={t('validFromHint')} required size="s" error={errors.validFrom}>
                <Input id="mandate-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </FormField>
            ) : null}
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveLabel={t('save')} onSave={() => void save()} state={feedback.state} testId="mandate-details-footer" />
      </DialogContent>
    </Dialog>
  );
}

const END_REASONS = ['debtor', 'creditor', 'superseded'] as const;

/** „Mandat beenden …“: Tag und Grund; abgelehnt, solange es in einem Einzug steckt, der noch nicht gebucht ist. */
function EndDialog({ mandateId, today, finalFocus, onClose }: { mandateId: string; today: string; finalFocus: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const t = useTranslations('finance.directDebit.mandate');
  const router = useRouter();
  const [endedOn, setEndedOn] = useState(today);
  const [reason, setReason] = useState<(typeof END_REASONS)[number]>('debtor');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => endMandateAction({ mandateId, endedOn, reason }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" finalFocus={finalFocus} data-testid="mandate-end-dialog">
        <DialogHeader>
          <DialogTitle>{t('endTitle')}</DialogTitle>
          <DialogDescription tone="body">{t('endText')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="mandate-ended-on" label={t('endedOn')} required size="s" error={errors.endedOn}>
              <Input id="mandate-ended-on" type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
            </FormField>
            <FormField id="mandate-end-reason" label={t('endReason')} required>
              <Select id="mandate-end-reason" value={reason} onChange={(e) => setReason(e.target.value as (typeof END_REASONS)[number])}>
                {END_REASONS.map((r) => (
                  <option key={r} value={r}>{t(`endReasons.${r}`)}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} destructive saveLabel={t('endConfirm')} onSave={() => void save()} state={feedback.state} testId="mandate-end-footer" />
      </DialogContent>
    </Dialog>
  );
}
