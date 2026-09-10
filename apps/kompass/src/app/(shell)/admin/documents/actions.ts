'use server';

import { readSetting, setSetting } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

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
