'use server';

import { createTeamMember, reorderTeam, setTeamMemberPublished, updateTeamMember } from '@kompass/module-website';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveTeamMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = { name: String(formData.get('name') ?? '').trim(), position: localizedFromForm(formData, 'position'), photoAssetId: String(formData.get('photoAssetId') ?? '') || null, petPhotoAssetId: String(formData.get('petPhotoAssetId') ?? '') || null };
  const result = id ? await updateTeamMember(deps, ctx, { id, ...fields }) : await createTeamMember(deps, ctx, fields);
  revalidatePath('/website/team');
  return toActionState(result, t, t('website.common.saved'));
}

export async function setTeamPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setTeamMemberPublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/team');
  return toActionState(result, t);
}

export async function reorderTeamAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderTeam(deps, ctx, { ids });
  revalidatePath('/website/team');
  return toActionState(result, t);
}
