'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createMandateFollowUpAction } from '../actions';

/**
 * Kopf eines Beschlusses (Lesesicht eines festgeschriebenen Vorgangs, Board 6b) mit der Nebenaktion „Auftrag anlegen …“:
 * eine Wiedervorlage des Kerns am Beschluss (nur mit dessen Recht).
 */
export function ResolutionHeader({ back, resolutionId, title, description, state, stateLabel, canFollowUp, users, today }: { back: { href: string; label: string }; resolutionId: string; title: string; description: ReactNode; state: 'adopted' | 'elected' | 'notElected' | 'rejected' | 'postponed' | 'withdrawn' | 'overridden'; stateLabel: string; canFollowUp: boolean; users: { id: string; name: string }[]; today: string }) {
  const t = useTranslations('governance.resolution');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [dueAt, setDueAt] = useState(today);
  const [assignee, setAssignee] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => createMandateFollowUpAction({ resolutionId, title: taskTitle, dueAt, assigneeUserId: assignee || null }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <PageHeader
        back={back}
        title={title}
        description={description}
        status={<StatusBadge tone={statusTone('resolution', state)} dot>{stateLabel}</StatusBadge>}
        more={canFollowUp ? [{ key: 'followUp', label: t('followUpMenu'), onSelect: () => setOpen(true) }] : []}
      />
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{t('followUpTitle')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <DialogBody>
                <FormGrid>
                  <FormField id="followup-title" label={t('followUpTask')} required size="full" error={errors.title}>
                    <Input id="followup-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                  </FormField>
                  <FormField id="followup-due" label={t('followUpDue')} required size="s" error={errors.dueAt}>
                    <Input id="followup-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                  </FormField>
                  <FormField id="followup-assignee" label={t('followUpAssignee')}>
                    <Select id="followup-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                      <option value="">{t('followUpNobody')}</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </Select>
                  </FormField>
                </FormGrid>
              </DialogBody>
            </form>
            <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} pending={pending} onSave={() => void save()} state={feedback.state} saveLabel={t('followUpSave')} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
