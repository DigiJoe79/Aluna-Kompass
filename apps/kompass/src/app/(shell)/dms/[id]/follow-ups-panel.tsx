'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/forms/field-error';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { completeFollowUpAction, createFollowUpAction, reopenFollowUpAction } from '../actions';

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
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createFollowUpAction.bind(null, documentId), idleState);
  const [pending, start] = useTransition();
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success') setOpen(false);
  }, [state]);

  const openOnes = followUps.filter((f) => !f.doneAt);
  const doneOnes = followUps.filter((f) => f.doneAt);

  const toggle = (followUp: FollowUpView) =>
    start(async () => {
      const result = followUp.doneAt
        ? await reopenFollowUpAction(documentId, followUp.id)
        : await completeFollowUpAction(documentId, followUp.id);
      if (result.status === 'error') toast.error(result.message);
    });

  return (
    <section data-testid="follow-ups-panel" className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{t('title')}</h3>
        {canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            {t('add')}
          </Button>
        ) : null}
      </div>

      {openOnes.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
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
                <span className={cn('font-medium', followUp.dueAt < today ? 'text-warning' : 'text-ink')}>
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
            <ul className="space-y-2 text-[13px] text-muted-ink">
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
        <DialogContent className="w-full sm:max-w-[480px] bg-surface p-6 shadow-md">
          <form action={action}>
            <DialogTitle className="font-heading text-[19px]">{t('add')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('addDescription')}</DialogDescription>

            {state.status === 'error' && Object.keys(errors).length === 0 ? (
              <p role="alert" className="mt-3 rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">
                {state.message}
              </p>
            ) : null}

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="dueAt" required>
                  {t('dueAt')}
                </Label>
                {/* In einer Woche nachsehen ist der häufigste Fall; wer es anders will, tippt. */}
                <Input id="dueAt" name="dueAt" type="date" defaultValue={inOneWeek} required />
                <FieldError id="dueAt-error" message={errors.dueAt} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="followUpTitle" required>
                  {t('titleField')}
                </Label>
                <Input id="followUpTitle" name="title" required />
                <FieldError id="followUpTitle-error" message={errors.title} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assigneeUserId">{t('assignee')}</Label>
                <Select id="assigneeUserId" name="assigneeUserId" defaultValue="">
                  <option value="">{t('everyone')}</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <span className="mr-auto text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <SubmitButton>{t('submit')}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
