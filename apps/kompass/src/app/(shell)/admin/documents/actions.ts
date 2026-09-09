'use server';

import { readSetting, renderDocument, setSetting, voidDocument } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createLetterheadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await renderDocument(deps, ctx, {
    templateKey: String(formData.get('templateKey') ?? 'letterhead'),
    input: { title: formData.get('title'), body: formData.get('body') ?? '' },
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

export async function setDocumentBaseAction(templateKey: string, baseId: string | null): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const current = { ...readSetting<Record<string, string>>(deps, 'documents.bases') };
  if (baseId) current[templateKey] = baseId;
  else delete current[templateKey];
  const result = await setSetting(deps, ctx, { key: 'documents.bases', value: current });
  revalidatePath('/admin/documents');
  return toActionState(result, t, t('documents.bases.saved'));
}
