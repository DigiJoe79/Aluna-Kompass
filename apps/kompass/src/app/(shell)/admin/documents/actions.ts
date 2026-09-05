'use server';

import { renderDocument, voidDocument } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createLetterheadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await renderDocument(deps, ctx, {
    templateKey: String(formData.get('templateKey') ?? 'letterhead'),
    input: { title: formData.get('title'), body: formData.get('body') ?? '', letterhead: formData.get('letterhead') === 'on' },
  });
  revalidatePath('/admin/documents');
  return toActionState(result, t, t('documents.toast.created'));
}

export async function voidDocumentAction(id: string, reason: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await voidDocument(deps, ctx, { id, reason });
  revalidatePath('/admin/documents');
  return toActionState(result, t, t('documents.toast.voided'));
}