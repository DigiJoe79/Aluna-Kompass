'use server';

import {
  applySeed,
  applyTemplateSync,
  createEntry,
  deleteEntry,
  previewTemplateSync,
  reorderEntries,
  setEntryPublished,
  setValues,
  siteTemplateDir,
  updateEntry,
  type Finding,
  type SyncPreview,
} from '@kompass/module-site';
import type { SeedReport } from '@kompass/module-site/client';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const DIR = () => siteTemplateDir();

export type SyncPreviewState =
  | { status: 'idle' }
  | { status: 'preview'; preview: SyncPreview }
  | { status: 'error'; message: string };

export async function previewSyncAction(): Promise<SyncPreviewState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await previewTemplateSync(deps, ctx, DIR());
  if (result.ok) return { status: 'preview', preview: result.value };
  const state = toActionState(result, t);
  return { status: 'error', message: state.status === 'error' ? state.message : t('errors.validation') };
}

export async function applySyncAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await applyTemplateSync(deps, ctx, { dir: DIR(), confirm: true });
  revalidatePath('/site/template');
  revalidatePath('/site', 'layout');
  return toActionState(result, t, t('site.template.readDone'));
}

export type SeedPreviewState =
  | { status: 'idle' }
  | { status: 'preview'; report: SeedReport }
  | { status: 'error'; message: string };

export async function previewSeedAction(): Promise<SeedPreviewState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await applySeed(deps, ctx, { confirm: false });
  if (result.ok) return { status: 'preview', report: result.value };
  const state = toActionState(result, t);
  return { status: 'error', message: state.status === 'error' ? state.message : t('errors.validation') };
}

export async function applySeedAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await applySeed(deps, ctx, { confirm: true });
  revalidatePath('/site/template');
  revalidatePath('/site', 'layout');
  return toActionState(result, t, t('site.seed.applied'));
}

export async function saveVariablesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const values = JSON.parse(String(formData.get('payload') ?? '{}')) as Record<string, unknown>;
  const result = await setValues(deps, ctx, { values });
  revalidatePath('/site/variables');
  return toActionState(result, t, t('site.variables.saved'));
}

export async function saveEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const collection = String(formData.get('collection') ?? '');
  const id = String(formData.get('id') ?? '');
  const payload = JSON.parse(String(formData.get('payload') ?? '{}')) as { slug?: string; data: Record<string, unknown> };
  const result = id
    ? await updateEntry(deps, ctx, { id, slug: payload.slug, data: payload.data })
    : await createEntry(deps, ctx, { collection, slug: payload.slug, data: payload.data });
  revalidatePath(`/site/c/${collection}`);
  if (!result.ok) return toActionState(result, t);
  if (!id) redirect(`/site/c/${collection}`);
  return toActionState(result, t, t('site.entries.saved'));
}

export async function deleteEntryAction(id: string, collection: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteEntry(deps, ctx, { id });
  revalidatePath(`/site/c/${collection}`);
  return toActionState(result, t, t('site.entries.deleted'));
}

export async function setEntryPublishedAction(id: string, isPublished: boolean, collection = ''): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setEntryPublished(deps, ctx, { id, isPublished });
  revalidatePath(`/site/c/${collection}`);
  return toActionState(result, t);
}

export async function reorderEntriesAction(collection: string, ids: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reorderEntries(deps, ctx, { collection, ids });
  revalidatePath(`/site/c/${collection}`);
  return toActionState(result, t);
}

export type { Finding };
