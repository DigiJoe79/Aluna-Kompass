'use client';

import type { ArticleRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveArticleAction } from './actions';

const empty = { de: '', en: '' };

export function ArticleForm({ article }: { article: ArticleRecord | null }) {
  const t = useTranslations('website.articles.form');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(saveArticleAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  return (
    <form action={action} className="grid gap-5 rounded-lg border border-line bg-surface p-6 md:grid-cols-2">
      {article ? <input type="hidden" name="id" value={article.id} /> : null}
      <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={article?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
      <FormField id="publishedAt" label={t('publishedAt')} error={errors.publishedAt}><Input id="publishedAt" name="publishedAt" type="date" defaultValue={article?.publishedAt ?? ''} className="font-mono" /></FormField>
      <LocalizedField name="title" label={t('title')} value={article?.title ?? empty} required errors={errors} />
      <LocalizedField name="lede" label={t('lede')} kind="textarea" rows={3} value={article?.lede ?? empty} errors={errors} />
      <LocalizedField name="body" label={t('body')} kind="markdown" rows={16} value={article?.body ?? empty} errors={errors} />
      <div className="flex justify-end md:col-span-2"><SubmitButton>{c('save')}</SubmitButton></div>
    </form>
  );
}
