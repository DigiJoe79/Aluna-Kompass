'use server';

import { createProject, reorderProjects, setProjectPublished, updateProject } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

export async function saveProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: localizedFromForm(formData, 'name'),
    type: (formData.get('type') as 'ongoing' | 'shortTerm') ?? 'ongoing',
    status: (formData.get('status') as 'active' | 'completed') ?? 'active',
    summary: localizedFromForm(formData, 'summary'),
    body: localizedFromForm(formData, 'body'),
    imageAssetId: String(formData.get('imageAssetId') ?? '') || null,
    betterplaceProjectId: String(formData.get('betterplaceProjectId') ?? '').trim() || null,
  };
  const result = id ? await updateProject(deps, ctx, { id, ...fields }) : await createProject(deps, ctx, fields);
  revalidatePath('/website/projects');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/website/projects/${result.value.id}`);
  return toActionState(result, t, t('website.common.saved'));
}

export async function setProjectPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setProjectPublished(deps, ctx, { id, isPublished });
  revalidatePath('/website/projects');
  return toActionState(result, t);
}

export async function reorderProjectsAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderProjects(deps, ctx, { ids });
  revalidatePath('/website/projects');
  return toActionState(result, t);
}
