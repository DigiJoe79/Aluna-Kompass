'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { completeFollowUpAction, createFollowUpAction, followUpMailStateAction, reopenFollowUpAction } from '../actions';
import { Notice } from '@/components/notice';
import { ActionForm } from '@/components/forms/action-form';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';

export interface FollowUpView {
  id: string;
  dueAt: string;
  title: string;
  assigneeName: string | null;
  doneAt: string | null;
}

/**
 * Wiedervorlagen am Vorgang: ein Datum und ein Anlass. Erledigt heißt
 * abgehakt, nicht weg — die Zeile bleibt, damit ein Vorgang zeigt, dass
 * jemand nachgesehen hat.
 */
export function FollowUpsPanel({
  documentId,
  followUps,
  users,
  today,
  canManage,
}: {
  documentId: string;
  followUps: FollowUpView[];
  users: { id: string; name: string }[];
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations('dms.followUps');
  const fmt = useDateFormat();
  const inOneWeek = new Date(Date.parse(`${today}T00:00:00.000Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createFollowUpAction.bind(null, documentId), idleState);
  const [pending, start] = useTransition();
  // Abhaken steht in den Zeilen der Liste: Die Ablehnung steht über der Liste.
  const toggleFb = useActionFeedback();
  const errors = state.status === 'error' ? state.fieldErrors : {};

  // Zuständig gesteuert (Rückmeldung Frage 2): Nach jeder Wahl fragt der Dialog, ob eine Mail ankommt; eine spätere Wahl
  // gilt, auch wenn die Antwort auf eine frühere später eintrifft (Zähler).
  const [assignee, setAssignee] = useState('');
  const [mailState, setMailState] = useState<'ready' | 'notNeeded' | 'noAddress' | 'unavailable' | null>(null);
  const asked = useRef(0);
  const chooseAssignee = (userId: string) => {
    setAssignee(userId);
    setMailState(null);
    const ticket = ++asked.current;
    if (!userId) return;
    void followUpMailStateAction(userId).then((result) => {
      if (ticket === asked.current) setMailState(result);
    });
  };
  const assigneeName = users.find((u) => u.id === assignee)?.name ?? '';

  useEffect(() => {
    if (!open) return;
    asked.current++;
    setAssignee('');
    setMailState(null);
  }, [open]);

  useEffect(() => {
    if (state.status === 'success') setOpen(false);
  }, [state]);

  const openOnes = followUps.filter((f) => !f.doneAt);
  const doneOnes = followUps.filter((f) => f.doneAt);

  const toggle = (followUp: FollowUpView) =>
    start(async () => {
      await toggleFb.run(() => (followUp.doneAt ? reopenFollowUpAction(documentId, followUp.id) : completeFollowUpAction(documentId, followUp.id)), { retry: () => toggle(followUp) });
    });

  return (
    <section data-testid="follow-ups-panel" className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <Section title={t('title')}
        actions={
          <>
            {canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                {t('add')}
              </Button>
            ) : null}
          </>
        }
      >
        <RefusalNotice action state={toggleFb.state} />

        {openOnes.length === 0 ? (
          <p className="text-meta text-muted-ink">{t('none')}</p>
        ) : (
          <ul className="space-y-2 text-meta">
            {openOnes.map((followUp) => (
              <li key={followUp.id} className="flex items-start gap-2">
                {canManage ? (
                  <Checkbox
                    aria-label={t('complete', { title: followUp.title })}
                    checked={false}
                    disabled={pending}
                    onCheckedChange={() => toggle(followUp)}
                  />
                ) : null}
                <span className="flex-1">
                  <span className={cn('font-semibold', followUp.dueAt < today ? 'text-warning' : 'text-ink')}>
                    {fmt.date(followUp.dueAt)}
                    {followUp.dueAt < today ? ` · ${t('overdue')}` : ''}
                  </span>
                  <span className="block text-ink-2">{followUp.title}</span>
                  {followUp.assigneeName ? <span className="block text-muted-ink">{followUp.assigneeName}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {doneOnes.length > 0 ? (
          <div className="mt-4">
            <Disclosure label={t('doneLabel')} count={doneOnes.length}>
              <ul className="space-y-2 text-meta text-muted-ink">
                {doneOnes.map((followUp) => (
                  <li key={followUp.id} className="flex items-start gap-2">
                    {canManage ? (
                      <Checkbox
                        aria-label={t('reopen', { title: followUp.title })}
                        checked
                        disabled={pending}
                        onCheckedChange={() => toggle(followUp)}
                      />
                    ) : null}
                    <span className="flex-1 line-through">
                      {fmt.date(followUp.dueAt)} · {followUp.title}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        ) : null}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="md" className="bg-surface shadow-md">
            <ActionForm action={action} state={state}>
              <DialogTitle>{t('add')}</DialogTitle>
              <DialogDescription>{t('addDescription')}</DialogDescription>

              <div className="mt-5">
                <FormGrid>
                  <FormField id="dueAt" label={t('dueAt')} required error={errors.dueAt} size="s">
                    {/* In einer Woche nachsehen ist der häufigste Fall; wer es anders will, tippt. */}
                    <Input id="dueAt" name="dueAt" type="date" defaultValue={inOneWeek} required />
                  </FormField>
                  <FormField id="followUpTitle" label={t('titleField')} required error={errors.title}>
                    <Input id="followUpTitle" name="title" required />
                  </FormField>
                  <FormField id="assigneeUserId" label={t('assignee')}>
                    <Select id="assigneeUserId" name="assigneeUserId" value={assignee} onChange={(e) => chooseAssignee(e.target.value)}>
                      {/* `null` heißt: niemand Bestimmtes zuständig — nicht „alle“ (03 B37, Joe 2026-10-16). */}
                      <option value="">{t('unassigned')}</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </FormGrid>
                {mailState === 'noAddress' || mailState === 'unavailable' ? (
                  <div className="mt-3" data-testid="follow-up-mail-hint">
                    <Notice level="hint">{mailState === 'noAddress' ? t('mailNoAddress', { name: assigneeName }) : t('mailUnavailable')}</Notice>
                  </div>
                ) : null}
              </div>

              <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('submit')} state={state} />
            </ActionForm>
          </DialogContent>
        </Dialog>
      </Section>
    </section>
  );
}
