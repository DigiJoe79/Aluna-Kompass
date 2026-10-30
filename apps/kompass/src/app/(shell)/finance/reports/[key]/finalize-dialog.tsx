'use client';

import type { ReportConfirmationReason, ReportParams } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConsequenceList } from '@/components/consequence-list';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FieldError } from '@/components/forms/field-error';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import type { ActionState } from '@/lib/actions';
import { finalizeReportAction, type FinalizeConfirmation } from '../actions';

/** Was das Festschreiben der Jahresrechnung zusätzlich mit sich bringt (Designer Frage 1; Planreview J1). */
export interface FinalizeConsequences {
  explanationMissing: boolean;
  remunerationWithoutBasis: number;
}

/** Die Begründungen in fester Folge wie `REPORT_CONFIRMATION_REASONS` (Planreview J1); nur Typen aus dem Finanzmodul im Browser. */
const REASONS: readonly ReportConfirmationReason[] = ['recoveryInitiated', 'basisNotRecorded', 'other'];

/** Der Konfliktcode des Dienstes ohne Begründung (`confirmToFinalize`); er steht am Feld „Begründung“. */
const NEEDS_REASON = 'annualAccountsRemunerationWithoutBasis';

/**
 * „‹Bericht› ‹Jahr› festschreiben“ (Board 2b, Designer Runde 7, 245): unumkehrbar abgelegt, aber keine Gefahr — der Knopf ist nicht rot; die Folge
 * steht in der Beschreibung. Eine Ablehnung des Dienstes bleibt im Dialog (MUSTER § A).
 *
 * Jahresrechnung (U1 Task 4): Folgen als `ConsequenceList` — „ohne Erläuterung“ sperrt nicht. Zahlungen an den Vorstand
 * ohne Grundlage verlangen eine Begründung: dann ein Dialog wie 348 (`RadioGroup`, bei „Sonstiges“ Text, Leiste `run`)
 * statt der Bestätigung. Ob eine Begründung fehlt, sagt der Dienst; der Knopf ist nie gesperrt.
 */
export function FinalizeDialog({
  open,
  onOpenChange,
  reportKey,
  params,
  shortHash,
  title,
  consequences,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportKey: string;
  params: ReportParams;
  shortHash: string;
  /** „Rücklagenspiegel 2025“ — der Dialog nennt den Bericht (Designer Runde 7, 245). */
  title: string;
  consequences?: FinalizeConsequences;
}) {
  const t = useTranslations('finance.reports.view');
  const router = useRouter();
  const done = (result: ActionState) => {
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.refresh();
    }
    return result;
  };
  const description = t.rich('confirm.description', { hash: shortHash, mono: (chunks) => <span className="font-mono">{chunks}</span> });
  const items = [
    ...(consequences?.explanationMissing ? [{ label: t('confirm.explanationMissing') }] : []),
    ...(consequences && consequences.remunerationWithoutBasis > 0 ? [{ label: t('confirm.remuneration', { count: consequences.remunerationWithoutBasis }) }] : []),
  ];
  if (consequences && consequences.remunerationWithoutBasis > 0) {
    return <ReasonDialog open={open} onOpenChange={onOpenChange} title={t('confirm.title', { report: title })} description={description} items={items} run={(confirmation) => finalizeReportAction(reportKey, params, confirmation).then(done)} />;
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('confirm.title', { report: title })}
      // Der Stand ist eine Kennung: mono (Designer Runde 7, 245).
      description={description}
      confirmLabel={t('finalize')}
      action={async () => done(await finalizeReportAction(reportKey, params))}
    >
      {items.length > 0 ? <ConsequenceList items={items} /> : null}
    </ConfirmDialog>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  run,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  items: { label: string }[];
  run: (confirmation: FinalizeConfirmation | undefined) => Promise<ActionState>;
}) {
  const t = useTranslations('finance.reports.view');
  const [reason, setReason] = useState<ReportConfirmationReason | ''>('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const state = feedback.state;
  const needsReason = state.status === 'error' && state.code === NEEDS_REASON;
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  const reasonError = needsReason ? state.message : fieldErrors['confirmation.reason'];
  const noteError = fieldErrors['confirmation.note'];

  const save = async () => {
    setPending(true);
    const trimmed = note.trim();
    const result = await feedback.run(() => run(reason ? { reason, note: reason === 'other' && trimmed ? trimmed : null } : undefined), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="finalize-reason-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription tone="body">{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <ConsequenceList items={items} />
            <div>
              <Label id="finalize-reason-label" required>
                {t('confirm.reason')}
              </Label>
              <RadioGroup aria-labelledby="finalize-reason-label" aria-required aria-describedby={reasonError ? 'finalize-reason-error' : undefined} value={reason} onValueChange={(v) => setReason(v as ReportConfirmationReason)} className="mt-2 gap-3">
                {REASONS.map((r) => (
                  <label key={r} className="flex cursor-pointer items-start gap-2 text-body text-ink">
                    <RadioGroupItem value={r} className="mt-0.5" />
                    <span>{t(`confirm.reasons.${r}`)}</span>
                  </label>
                ))}
              </RadioGroup>
              <FieldError id="finalize-reason-error" message={reasonError} />
            </div>
            {reason === 'other' ? (
              <FormField id="finalize-note" label={t('confirm.note')} required error={noteError} size="full">
                <Textarea id="finalize-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </FormField>
            ) : null}
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('finalize')}
          onSave={() => void save()}
          state={needsReason ? { status: 'idle' } : withUnplacedFieldErrors(state, ['confirmation.reason', 'confirmation.note'])}
        />
      </DialogContent>
    </Dialog>
  );
}
