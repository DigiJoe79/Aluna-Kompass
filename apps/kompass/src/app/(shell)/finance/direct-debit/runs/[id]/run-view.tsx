'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge, isNormalInList, statusTone } from '@/components/status-badge';
import { Steps, type Step } from '@/components/steps';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RowLink, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { buildFileAction, cancelRunAction, markSubmittedAction, removeRunItemAction, resetSubmittedAction } from '../../actions';
import { ReturnDialog, type OpenReturn } from '../../return-dialog';

type RunStatus = 'draft' | 'fileCreated' | 'submitted' | 'booked' | 'expired' | 'cancelled';

export interface RunViewProps {
  back: { href: string; label: string };
  run: {
    id: string;
    collectionDate: string;
    status: RunStatus;
    count: number;
    sumCents: number;
    accountName: string;
    createdOn: string;
    fileCreatedAt: string | null;
    submittedOn: string | null;
    submittedBy: string | null;
    submitFrom: string;
    submitBy: string;
    cancelledAt: string | null;
  };
  items: { id: string; debtorName: string; remittance: string; rateOn: string | null; mandateReference: string; amountCents: number; returnStatus: 'open' | 'resolved' | null; paidOtherwise: boolean; href: string | null }[];
  openReturns: (OpenReturn & { returnedOn: string })[];
  returnDays: string[];
  today: string;
  canPrepare: boolean;
}

/**
 * Einzug (Handoff 2a § 1.3, D5): Vorgang mit dem Zustand im Kopf und ⋯ „Verwerfen …“ (nach der Einreichung lehnt der
 * Dienst mit Auswegen ab; am selben Tag steht „Als nicht eingereicht zurücksetzen“ daneben). Die Schritte sind eine
 * Prüfliste (`Steps compact`): Datei erzeugen → Bei der Bank einreichen → Gutschrift (erledigt sich nur über die
 * Arbeitsliste). Rückgaben als `Notice warn` mit „Rückgabe klären …“; Posten mit Summe im Fuß.
 */
export function RunView({ back, run, items, openReturns, returnDays, today, canPrepare }: RunViewProps) {
  const t = useTranslations('finance.directDebit.run');
  const ts = useTranslations('finance.directDebit.states');
  const tl = useTranslations('finance.directDebit.list');
  const tc = useTranslations('finance.directDebit.returnCodes');
  const { date } = useDateFormat();
  const router = useRouter();
  const menuRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<'cancel' | 'reset' | 'submit' | null>(null);
  const [resolving, setResolving] = useState<OpenReturn | null>(null);
  const [removing, setRemoving] = useState<RunViewProps['items'][number] | null>(null);
  const fileFb = useActionFeedback();
  const [building, setBuilding] = useState(false);
  const locked = run.status === 'submitted' || run.status === 'booked' || run.status === 'cancelled';

  const buildFile = async () => {
    setBuilding(true);
    const result = await fileFb.run(() => buildFileAction(run.id), { retry: () => void buildFile() });
    setBuilding(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    router.refresh();
  };

  const fileDone = run.fileCreatedAt !== null && run.status !== 'draft';
  const submitted = run.status === 'submitted' || run.status === 'booked';
  const stepState = (done: boolean, active: boolean): Step['state'] => (done ? 'done' : active ? 'active' : 'todo');
  const steps: Step[] = [
    {
      key: 'file',
      label: t('steps.file'),
      state: stepState(fileDone, !fileDone),
      detail: fileDone ? date(run.fileCreatedAt) : undefined,
      action: fileDone ? (
        <span className="flex flex-wrap gap-3 text-meta">
          <a href={`/finance/direct-debit/runs/${run.id}/file?kind=xml`} download className="text-link underline underline-offset-2" data-testid="run-download-xml">{t('downloadXml')}</a>
          <a href={`/finance/direct-debit/runs/${run.id}/file?kind=csv`} download className="text-link underline underline-offset-2" data-testid="run-download-csv">{t('downloadCsv')}</a>
        </span>
      ) : canPrepare ? (
        <Button type="button" onClick={() => void buildFile()} disabled={building} data-testid="run-build-file">{t('createFile')}</Button>
      ) : undefined,
      below: fileFb.state.status === 'error' ? <RefusalNotice action state={fileFb.state} /> : undefined,
    },
    {
      key: 'submit',
      label: t('steps.submit'),
      state: stepState(submitted, fileDone && !submitted),
      detail: submitted ? [date(run.submittedOn), run.submittedBy].filter(Boolean).join(' · ') : t('steps.submitWindow', { from: date(run.submitFrom), by: date(run.submitBy) }),
      action: fileDone && !submitted && canPrepare ? (
        <Button type="button" variant="outline" onClick={() => setDialog('submit')} data-testid="run-mark-submitted">{t('markSubmitted')}</Button>
      ) : undefined,
    },
    {
      key: 'credit',
      label: t('steps.credit'),
      state: stepState(run.status === 'booked', submitted && run.status !== 'booked'),
      detail: run.status === 'booked' ? formatEuro(run.sumCents) : t('steps.creditWait'),
    },
  ];
  const lastReturn = returnDays.at(-1);
  const done = run.status === 'booked' ? (lastReturn ? t('steps.creditDoneReturns', { count: returnDays.length, date: date(lastReturn) }) : t('steps.creditDone')) : undefined;

  const header = (
    <PageHeader
      title={t('title', { date: date(run.collectionDate) })}
      description={[tl('itemCount', { count: run.count }), formatEuro(run.sumCents), run.accountName, t('createdOn', { date: date(run.createdOn) })].join(' · ')}
      back={back}
      status={<StatusBadge tone={statusTone('debitRun', run.status)} dot>{ts(`run.${run.status}`)}</StatusBadge>}
      actions={
        canPrepare ? (
          <RecordActions
            triggerRef={menuRef}
            testId="run-actions"
            actions={[
              { key: 'reset', label: t('reset'), kind: 'undoing', onSelect: () => setDialog('reset'), hidden: run.status !== 'submitted' || run.submittedOn !== today, testId: 'run-reset' },
              // Verworfen ist dauerhaft und steht im Kopf; danach kein Eintrag mehr.
              { key: 'cancel', label: t('cancel'), kind: 'undoing', onSelect: () => setDialog('cancel'), hidden: run.status === 'cancelled', testId: 'run-cancel' },
            ]}
          />
        ) : null
      }
    />
  );

  return (
    <Page width="standard" header={header}>
      <div className="flex flex-col gap-5">
        {run.status === 'expired' ? <Notice level="warn">{t('expiredHint', { date: date(run.submitBy) })}</Notice> : null}
        {run.status === 'cancelled' ? (
          <Notice level="hint">{t('cancelledOn', { date: date(run.cancelledAt) })}</Notice>
        ) : (
          <section aria-label={t('steps.label')} className="rounded-lg border border-line bg-surface p-5">
            <Steps density="compact" label={t('steps.label')} steps={steps} done={done} testId="run-steps" />
          </section>
        )}

        {/* Plan N2 Task 2 (R2): Die Bank zieht ein, was schon anders bezahlt ist. */}
        {items.some((i) => i.paidOtherwise) ? <Notice level="warn" testId="run-paid-otherwise">{t('paidOtherwiseHint', { count: items.filter((i) => i.paidOtherwise).length })}</Notice> : null}

        {openReturns.map((r) => (
          <Notice
            key={r.id}
            level="warn"
            title={ts('return.open')}
            action={canPrepare ? <Button type="button" variant="outline" onClick={() => setResolving(r)} data-testid="run-resolve-return">{t('resolveReturn')}</Button> : undefined}
          >
            {t('returnText', {
              name: r.debtorName,
              amount: formatEuro(r.amountCents),
              date: date(r.returnedOn),
              reason: r.returnCode ? `${r.returnCode}, ${tc.has(r.returnCode) ? tc(r.returnCode) : tc('unknown', { code: r.returnCode })}` : t('noCode'),
            })}
            {r.feeCents > 0 ? ` ${t('returnFee', { amount: formatEuro(r.feeCents) })}` : null}
          </Notice>
        ))}

        <Section title={t('items')}>
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.payer')}</TableHead>
                  <TableHead>{t('columns.for')}</TableHead>
                  <TableHead col="meta">{t('columns.reference')}</TableHead>
                  <TableHead col="amount" className="text-right">{t('columns.amount')}</TableHead>
                  <TableHead col="status">{t('columns.state')}</TableHead>
                  {canPrepare && !locked ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id} data-testid="run-item">
                    <TableCell col="title">{i.href ? <RowLink href={i.href}>{i.debtorName}</RowLink> : i.debtorName}</TableCell>
                    {/* Wofür: eine Rate mit ihrem Tag, ein Beitrag mit seinem Verwendungszweck. */}
                    <TableCell className="text-ink-2">{i.rateOn ? tl('rateOf', { date: date(i.rateOn) }) : i.remittance}</TableCell>
                    <TableCell col="meta" selectable className="text-ink-2">{i.mandateReference}</TableCell>
                    <TableCell col="amount" className="text-right tabular-nums text-ink">{formatEuro(i.amountCents)}</TableCell>
                    <TableCell col="status">
                      {i.returnStatus && !isNormalInList('debitReturn', i.returnStatus) ? <StatusBadge tone={statusTone('debitReturn', i.returnStatus)} dot>{ts(`return.${i.returnStatus}`)}</StatusBadge> : null}
                      {i.paidOtherwise ? <StatusBadge tone="warning" dot>{t('paidOtherwise')}</StatusBadge> : null}
                    </TableCell>
                    {canPrepare && !locked ? (
                      <TableCell col="actions">
                        <RowMenu name={i.debtorName} items={[{ key: 'remove', label: t('removeItem'), onSelect: () => setRemoving(i), testId: 'run-item-remove' }]} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="border-t border-line-strong bg-surface-2">
                <TableRow>
                  <TableCell col="span" colSpan={canPrepare && !locked ? 6 : 5} className="w-full text-hint">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-muted-ink">{t('total')}</span>
                      <span className="ml-auto text-right tabular-nums text-ink" data-testid="run-total">{formatEuro(run.sumCents)}</span>
                    </span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => setDialog(open ? 'cancel' : null)}
        title={t('cancelTitle')}
        description={t('cancelText')}
        confirmLabel={t('cancelConfirm')}
        destructive
        finalFocus={menuRef}
        action={async () => {
          const result = await cancelRunAction(run.id);
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      />
      <ConfirmDialog
        open={dialog === 'reset'}
        onOpenChange={(open) => setDialog(open ? 'reset' : null)}
        title={t('resetTitle')}
        description={t('resetText')}
        confirmLabel={t('resetConfirm')}
        finalFocus={menuRef}
        action={async () => {
          const result = await resetSubmittedAction(run.id);
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={t('removeTitle', { name: removing?.debtorName ?? '' })}
        description={t('removeText')}
        confirmLabel={t('removeConfirm')}
        action={async () => {
          const result = await removeRunItemAction(removing!.id);
          if (result.status === 'success') {
            toast.success(result.message);
            router.refresh();
          }
          return result;
        }}
      />
      {dialog === 'submit' ? <SubmitDialog runId={run.id} today={today} onClose={() => setDialog(null)} /> : null}
      {resolving ? <ReturnDialog item={resolving} onClose={() => setResolving(null)} /> : null}
    </Page>
  );
}

/** „Als eingereicht markieren“ (13b): ein kleiner Dialog mit dem Tag der Einreichung, Vorgabe heute. */
function SubmitDialog({ runId, today, onClose }: { runId: string; today: string; onClose: () => void }) {
  const t = useTranslations('finance.directDebit.run');
  const router = useRouter();
  const [day, setDay] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => markSubmittedAction(runId, day), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="submit-dialog">
        <DialogHeader>
          <DialogTitle>{t('submitTitle')}</DialogTitle>
          <DialogDescription>{t('submitText')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="run-submitted-on" label={t('submittedOn')} required size="s" error={errors.submittedOn}>
              <Input id="run-submitted-on" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} pending={pending} saveDisabled={!day} saveLabel={t('markSubmitted')} onSave={() => void save()} state={feedback.state} testId="submit-footer" />
      </DialogContent>
    </Dialog>
  );
}
