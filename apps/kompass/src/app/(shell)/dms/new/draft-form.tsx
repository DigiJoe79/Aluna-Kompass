'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { idleState } from '@/lib/actions';
import { createDraftAction } from '../actions';

export function DraftForm({
  types,
  folders,
  contacts,
}: {
  types: { key: string; label: string }[];
  folders: string[];
  contacts: { id: string; name: string }[];
}) {
  const t = useTranslations('dms');
  const [state, formAction, isPending] = useActionState(createDraftAction, idleState);

  return (
    <form action={formAction} className="space-y-4 rounded-md border border-line bg-surface p-6">
      {state.status === 'error' && (
        <div className="rounded-md bg-error-bg p-3 text-[13px] text-error">{state.message}</div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="subject">{t('fields.subject')}</Label>
        <Input id="subject" name="subject" required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="body">{t('fields.body')}</Label>
        <textarea
          id="body"
          name="body"
          rows={10}
          className="w-full rounded-md border border-line-strong bg-field p-2.5 font-mono text-[13px] text-ink shadow-xs focus:border-ring focus:outline-hidden"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="typeKey">{t('fields.type')}</Label>
          <select
            id="typeKey"
            name="typeKey"
            defaultValue="letter"
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="folder">{t('fields.folder')}</Label>
          <select
            id="folder"
            name="folder"
            defaultValue=""
            className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
          >
            <option value="">{t('inbox')}</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recipientId">{t('fields.recipient')}</Label>
        <select
          id="recipientId"
          name="recipientId"
          defaultValue=""
          className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
        >
          <option value="">{t('fields.noRecipient')}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="pt-2">
        <Button type="submit" disabled={isPending}>
          {t('saveDraft')}
        </Button>
      </div>
    </form>
  );
}
