'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RecordActions } from '@/components/record-actions';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { endPledgeAction, pausePledgeAction } from '../../actions';

/** ⋯ an der Zusage (Handoff 2a § 1.5): „Zusage ruhen lassen …“ (von, bis) und „Zusage beenden …“ (zum Tag). */
export function PledgeActions({ pledgeId, today }: { pledgeId: string; today: string }) {
  const t = useTranslations('finance.directDebit.pledge');
  const router = useRouter();
  const menuRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<'pause' | 'end' | null>(null);
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const close = () => {
    feedback.reset();
    setDialog(null);
  };
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => (dialog === 'pause' ? pausePledgeAction({ pledgeId, from, until }) : endPledgeAction({ pledgeId, endedOn: from })), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    close();
    router.refresh();
  };

  return (
    <>
      <RecordActions
        triggerRef={menuRef}
        testId="pledge-actions"
        actions={[
          { key: 'pause', label: t('pause'), kind: 'reversible', onSelect: () => setDialog('pause'), testId: 'pledge-pause' },
          { key: 'end', label: t('end'), kind: 'undoing', onSelect: () => setDialog('end'), testId: 'pledge-end' },
        ]}
      />
      <Dialog open={dialog !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent size="sm" finalFocus={menuRef}>
          <DialogHeader>
            <DialogTitle>{t(dialog === 'end' ? 'endTitle' : 'pauseTitle')}</DialogTitle>
            <DialogDescription tone={dialog === 'end' ? 'body' : 'meta'}>{t(dialog === 'end' ? 'endText' : 'pauseText')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormGrid>
              <FormField id="pledge-from" label={t(dialog === 'end' ? 'endedOn' : 'pauseFrom')} required size="s" error={errors.from ?? errors.endedOn}>
                <Input id="pledge-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </FormField>
              {dialog === 'pause' ? (
                <FormField id="pledge-until" label={t('pauseUntil')} required size="s" error={errors.until}>
                  <Input id="pledge-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                </FormField>
              ) : null}
            </FormGrid>
          </DialogBody>
          <FormActionBar placement="dialog" mode="run" cancel={close} pending={pending} destructive={dialog === 'end'} saveDisabled={!from || (dialog === 'pause' && !until)} saveLabel={t(dialog === 'end' ? 'endConfirm' : 'pauseConfirm')} onSave={() => void save()} state={feedback.state} testId="pledge-action-footer" />
        </DialogContent>
      </Dialog>
    </>
  );
}
