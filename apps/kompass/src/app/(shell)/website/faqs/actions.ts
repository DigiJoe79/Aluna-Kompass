'use server';

import { createFaq, reorderFaqs, setFaqPublished, updateFaq } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveFaqAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    category: localizedFromForm(formData, 'category'),
    question: localizedFromForm(formData, 'question'),
    answer: localizedFromForm(formData, 'answer'),
  };
  const result = id ? await updateFaq(deps, ctx, { id, ...fields }) : await createFaq(deps, ctx, fields);
  revalidatePath('/website/faqs');
  return toActionState(result, t, t('website.common.saved'));
}

export async function setFaqPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setFaqPublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/faqs');
  return toActionState(result, t);
}

export async function reorderFaqsAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderFaqs(deps, ctx, { ids });
  revalidatePath('/website/faqs');
  return toActionState(result, t);
}
