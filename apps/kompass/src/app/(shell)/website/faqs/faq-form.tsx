'use client';

import type { FaqRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { idleState } from '@/lib/actions';
import { saveFaqAction } from './actions';

export function FaqDialog({ faq, trigger }: { faq: FaqRecord | null; trigger: React.ReactElement }) {
  const t = useTranslations('website.faqs.form');
  const c = useTranslations('website.common');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveFaqAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') { toast.success(state.message ?? ''); setOpen(false); } }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="w-[640px] bg-surface shadow-md">
        <form action={action} className="grid gap-4 md:grid-cols-2">
          <DialogTitle className="font-heading text-[19px] md:col-span-2">{faq ? t('editTitle') : t('createTitle')}</DialogTitle>
          {faq ? <input type="hidden" name="id" value={faq.id} /> : null}
          {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error md:col-span-2">{state.message}</p> : null}
          <LocalizedField name="category" label={t('category')} value={faq?.category ?? { de: '', en: '' }} required errors={errors} />
          <LocalizedField name="question" label={t('question')} value={faq?.question ?? { de: '', en: '' }} required errors={errors} />
          <LocalizedField name="answer" label={t('answer')} kind="textarea" rows={4} value={faq?.answer ?? { de: '', en: '' }} required errors={errors} />
          <DialogFooter className="md:col-span-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{c('back')}</Button><SubmitButton>{c('save')}</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
