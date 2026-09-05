'use client';

import type { PageRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { updatePageAction } from '../actions';
import { BlocksEditor } from './blocks-editor';

export function PageForm({ page }: { page: PageRecord }) {
  const t = useTranslations('website.pages.form');
  const [state, action] = useActionState(updatePageAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  return (
    <form action={action} className="grid gap-5 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
      <input type="hidden" name="key" value={page.key} />
      <LocalizedField name="title" label={t('title')} value={page.title} hint={t('titleHint')} errors={errors} />
      <LocalizedField name="lede" label={t('lede')} kind="textarea" rows={3} value={page.lede} errors={errors} />
      <LocalizedField name="body" label={t('body')} kind="markdown" rows={14} value={page.body} hint={t('bodyHint')} errors={errors} />
      <LocalizedField name="metaDescription" label={t('meta')} value={page.metaDescription} errors={errors} />
      <BlocksEditor initial={page.blocks} />
      <div className="flex justify-end md:col-span-2"><SubmitButton>{t('save')}</SubmitButton></div>
    </form>
  );
}
