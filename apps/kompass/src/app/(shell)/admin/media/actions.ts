'use server';

import { createMediaFolder, deleteMediaAsset, deleteMediaFolder, moveMediaAsset, renameMediaFolder } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function deleteMediaAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteMediaAsset(deps, ctx, { id });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.deleted'));
}

export async function moveMediaAction(id: string, folder: string | null): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await moveMediaAsset(deps, ctx, { id, folder });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.movedToast'));
}

export async function createFolderAction(path: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createMediaFolder(deps, ctx, { path });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.created'));
}

export async function renameFolderAction(from: string, to: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await renameMediaFolder(deps, ctx, { from, to });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.renamed'));
}

export async function deleteFolderAction(path: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteMediaFolder(deps, ctx, { path });
  revalidatePath('/admin/media');
  return toActionState(result, t, t('media.folderDeleted'));
}
