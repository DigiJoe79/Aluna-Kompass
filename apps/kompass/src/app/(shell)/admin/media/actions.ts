'use server';

import { createMediaFolder, deleteMediaAsset, deleteMediaFolder, moveMediaAsset, renameMediaFolder, storeMediaAssetDetailed } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function uploadMediaAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  const folder = formData.get('folder');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: t('content.noFile'), fieldErrors: {} };
  }
  const result = await storeMediaAssetDetailed(deps, ctx, {
    originalName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    declaredMimeType: file.type,
    folder: typeof folder === 'string' && folder !== '' ? folder : null,
  });
  revalidatePath('/admin/media');
  if (!result.ok) return toActionState(result, t);
  // Dedup-Treffer: Der Datensatz lag schon da, womöglich in einem anderen Ordner —
  // „hochgeladen“ wäre gelogen, und im offenen Ordner erschiene nichts.
  const { record, created } = result.value;
  const message = created ? t('media.uploaded') : t('media.alreadyStored', { filename: record.filename, folder: record.folder ?? t('media.noFolder') });
  return { status: 'success', message, data: { id: record.id, filename: record.filename, folder: record.folder, created } };
}

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
