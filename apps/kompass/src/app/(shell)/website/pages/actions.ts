'use server';

import { updatePage } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { jsonFromForm, localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function updatePageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const key = String(formData.get('key') ?? '');
  const result = await updatePage(deps, ctx, {
    key,
    title: localizedFromForm(formData, 'title'),
    lede: localizedFromForm(formData, 'lede'),
    body: localizedFromForm(formData, 'body'),
    metaDescription: localizedFromForm(formData, 'metaDescription'),
    blocks: jsonFromForm(formData, 'blocks', []),
  });
  revalidatePath('/website/pages');
  return toActionState(result, t, t('website.common.saved'));
}
