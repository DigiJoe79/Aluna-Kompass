'use server';

import { createArticle, reorderArticles, setArticlePublished, updateArticle } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveArticleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    title: localizedFromForm(formData, 'title', deps.locales()),
    lede: localizedFromForm(formData, 'lede', deps.locales()),
    body: localizedFromForm(formData, 'body', deps.locales()),
    publishedAt: String(formData.get('publishedAt') ?? '') || null,
  };
  const result = id ? await updateArticle(deps, ctx, { id, ...fields }) : await createArticle(deps, ctx, fields);
  revalidatePath('/website/articles');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/website/articles/${result.value.id}`);
  return toActionState(result, t, t('website.common.saved'));
}

export async function setArticlePublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setArticlePublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/articles');
  return toActionState(result, t);
}

export async function reorderArticlesAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderArticles(deps, ctx, { ids });
  revalidatePath('/website/articles');
  return toActionState(result, t);
}
