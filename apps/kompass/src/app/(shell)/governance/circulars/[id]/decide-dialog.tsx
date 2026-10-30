'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { decideAndSealCircularAction } from '../actions';

/**
 * „Beschluss eintragen“ (`sm`): Tag, wer feststellt, Ergebnis (vorgeschlagen nach der Auswertung). Gegen die Auswertung
 * ein Hinweis und eine Begründung. Danach festgeschrieben mit Nummer — nur hier in Kompass.
 */
export function DecideDialog({ circularId, today, people, chairId, reached, onClose }: { circularId: string; today: string; people: { id: string; name: string }[]; chairId: string | null; reached: boolean; onClose: () => void }) {
  const t = useTranslations('governance.circular');
  const router = useRouter();
  const [on, setOn] = useState(today);
  const [by, setBy] = useState(chairId ?? people[0]?.id ?? '');
  const [outcome, setOutcome] = useState<'adopted' | 'rejected'>(reached ? 'adopted' : 'rejected');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const against = (outcome === 'adopted') !== reached;
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => decideAndSealCircularAction({ id: circularId, outcome, outcomeReason: against ? reason.trim() || null : null, decidedOn: on, decidedByContactId: by }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') {
      router.refresh();
      return;
    }
    toast.success(result.message ?? '');
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('decideTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="decide-on" label={t('decidedOn')} required size="full" error={errors.decidedOn}>
                <Input id="decide-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
              </FormField>
              <FormField id="decide-by" label={t('decidedBy')} required size="full" error={errors.decidedByContactId}>
                <Select id="decide-by" value={by} onChange={(e) => setBy(e.target.value)}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
              <FormField id="decide-outcome" label={t('outcome')} size="full">
                <Segmented<'adopted' | 'rejected'> className="self-start" aria-label={t('outcome')} value={outcome} onValueChange={setOutcome} options={[{ value: 'adopted', label: t('adopted') }, { value: 'rejected', label: t('rejected') }]} />
              </FormField>
              {against ? (
                <FormField id="decide-reason" label={t('reason')} required size="full" error={errors.outcomeReason}>
                  <Textarea id="decide-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
              ) : null}
            </FormGrid>
            {against ? <div className="mt-3"><Notice level="warn">{t('againstEvaluation')}</Notice></div> : null}
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" mode="create" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('decide')} saveTestId="decide-save" />
      </DialogContent>
    </Dialog>
  );
}
