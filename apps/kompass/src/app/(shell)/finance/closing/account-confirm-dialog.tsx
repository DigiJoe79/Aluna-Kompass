'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { confirmAccountAction } from './actions';

type Choice = 'balanceConfirmed' | 'notReconcilable';

/** Zahlungsdienst bestätigen (Board 13b, Dialog `sm`): „Kontostand stimmt“ oder „nicht abstimmbar“, Begründung frei. */
export function AccountConfirmDialog({ open, onOpenChange, fiscalYearId, endsOn, account }: { open: boolean; onOpenChange: (open: boolean) => void; fiscalYearId: string; endsOn: string; account: { accountId: string; name: string; hasBalance: boolean } }) {
  const t = useTranslations('finance.closing.statements.serviceDialog');
  const fmt = useDateFormat();
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | ''>('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (!open) return;
    setChoice(account.hasBalance ? '' : 'notReconcilable');
    setNote('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.accountId]);
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => confirmAccountAction(fiscalYearId, account.accountId, (choice || 'balanceConfirmed') as Choice, choice === 'notReconcilable' ? note : null), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('done', { account: account.name }));
    onOpenChange(false);
    router.refresh();
  };
  const choices: Choice[] = account.hasBalance ? ['balanceConfirmed', 'notReconcilable'] : ['notReconcilable'];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="closing-service-dialog">
        <DialogHeader>
          <DialogTitle>{t('title', { account: account.name })}</DialogTitle>
          <DialogDescription>{t('description', { date: fmt.date(endsOn) })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div>
              <Label id="closing-service-choice" required>
                {t('choice')}
              </Label>
              <RadioGroup aria-labelledby="closing-service-choice" aria-required value={choice} onValueChange={(v) => setChoice(v as Choice)} className="mt-2 gap-3">
                {choices.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2 text-body text-ink">
                    <RadioGroupItem value={c} />
                    {t(c)}
                  </label>
                ))}
              </RadioGroup>
            </div>
            {choice === 'notReconcilable' ? (
              <FormField id="closing-service-note" label={t('note')} error={fieldErrors.note} size="full">
                <Textarea id="closing-service-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </FormField>
            ) : null}
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={() => void save()} saveDisabled={!choice} state={withUnplacedFieldErrors(feedback.state, ['note', 'kind'])} testId="closing-service-footer" />
      </DialogContent>
    </Dialog>
  );
}
