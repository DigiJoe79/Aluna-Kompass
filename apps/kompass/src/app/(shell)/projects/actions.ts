'use server';

import { createProject, reorderProjects, setProjectPublished, updateProject } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { localizedFromForm } from '@/lib/localized-form';
import { requireSession } from '@/lib/request-context';

/** Die Zeilen der Verweisliste, in Reihenfolge; ganz leere Zeilen zählen nicht. */
function externalLinksFromForm(formData: FormData): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  for (let i = 0; formData.has(`externalLinks.${i}.label`) || formData.has(`externalLinks.${i}.url`); i++) {
    const label = String(formData.get(`externalLinks.${i}.label`) ?? '').trim();
    const url = String(formData.get(`externalLinks.${i}.url`) ?? '').trim();
    if (label || url) links.push({ label, url });
  }
  return links;
}

export async function saveProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const id = String(formData.get('id') ?? '');
  const fields = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: localizedFromForm(formData, 'name', deps.locales()),
    type: (formData.get('type') as 'ongoing' | 'shortTerm') ?? 'ongoing',
    status: (formData.get('status') as 'active' | 'completed') ?? 'active',
    summary: localizedFromForm(formData, 'summary', deps.locales()),
    body: localizedFromForm(formData, 'body', deps.locales()),
    imageAssetId: String(formData.get('imageAssetId') ?? '') || null,
    externalLinks: externalLinksFromForm(formData),
  };
  const result = id ? await updateProject(deps, ctx, { id, ...fields }) : await createProject(deps, ctx, fields);
  revalidatePath('/projects');
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/projects/${result.value.id}`);
  return toActionState(result, t, t('content.saved'));
}

export async function setProjectPublishedAction(id: string, isPublished: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setProjectPublished(deps, ctx, { id, isPublished });
  revalidatePath('/projects');
  return toActionState(result, t);
}

export async function reorderProjectsAction(ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderProjects(deps, ctx, { ids });
  revalidatePath('/projects');
  return toActionState(result, t);
}
