'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { createLetterheadAction } from './actions';

export function CreateDocumentDialog({ templates }: { templates: { key: string; enabled: boolean; reason?: string }[] }) {
  const t = useTranslations('documents.create');
  const c = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLetterheadAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => {
    if (state.status === 'success') {
      setOpen(false);
      toast.success(state.message ?? '');
      router.push(`/admin/documents?selected=${(state.data as { id: string }).id}`);
    }
  }, [state, router]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>{t('button')}</DialogTrigger>
      <DialogContent className="w-[560px] bg-surface shadow-md">
        <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
          {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
          <FormField id="templateKey" label={t('template')}>
            <select id="templateKey" name="templateKey" className="h-9 rounded-md border border-line-strong bg-field px-2 text-[14px]" defaultValue="letterhead">
              {templates.map((tpl) => <option key={tpl.key} value={tpl.key} disabled={!tpl.enabled}>{t(`templates.${tpl.key}`)}{tpl.enabled ? '' : ` (${tpl.reason ?? ''})`}</option>)}
            </select>
          </FormField>
          <FormField id="title" label={t('titleField')} error={errors.title}><Input id="title" name="title" required maxLength={120} /></FormField>
          <FormField id="body" label={t('body')} error={errors.body}><Textarea id="body" name="body" rows={6} maxLength={5000} /></FormField>
          <div className="flex items-center gap-2"><Checkbox id="letterhead" name="letterhead" defaultChecked /><Label htmlFor="letterhead">{t('letterhead')}</Label></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('cancel')}</Button>
            <SubmitButton>{pending ? t('rendering') : t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
