'use server';

import { guardAction } from '@/lib/action-guard';
import { aiLabelingEnabled, createMediaFolder, deleteMediaAsset, deleteMediaFolder, getMediaAssetInfo, moveMediaAsset, renameMediaFolder, setMediaAiKind, storeMediaAssetDetailed, type AiKind } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { listingReference, type MediaListingItem } from '@/lib/media-listing';
import { requireSession } from '@/lib/request-context';

export async function uploadMediaAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#uploadMediaAction', async () => {
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
    // Art und Typ für den Schritt „Bildkennzeichnung“ danach; ausgeschaltet zeigt die Oberfläche keine Art (Spec KI-Transparenz).
    const aiKind: AiKind = aiLabelingEnabled(deps) ? record.aiKind : 'none';
    return { status: 'success', message, data: { id: record.id, filename: record.filename, folder: record.folder, created, width: record.width, height: record.height, mimeType: record.mimeType, aiKind } };
  });
}

export async function deleteMediaAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#deleteMediaAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteMediaAsset(deps, ctx, { id });
    revalidatePath('/admin/media');
    return toActionState(result, t, t('media.deleted'));
  });
}

/**
 * Verschiebt eine Datei; `expectedFolder` nur beim „Rückgängig“: Liegt sie
 * inzwischen woanders, lehnt der Dienst ab (Spec § 9). `data` wie in der
 * Akte (`{ moved, skipped }`), damit der Toast dieselbe Hilfe nutzt.
 */
export async function moveMediaAction(id: string, folder: string | null, expectedFolder?: string | null): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#moveMediaAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveMediaAsset(deps, ctx, { id, folder, ...(expectedFolder !== undefined ? { expectedFolder } : {}) });
    if (!result.ok) return toActionState(result, t);
    if (!result.value.moved) return { status: 'success', data: { moved: [], skipped: [id] } };
    revalidatePath('/admin/media');
    return { status: 'success', data: { moved: [id], skipped: [] } };
  });
}

/** Ein Ordnerpfad aus Elternordner und Name; der Name ohne Rand, den Rest prüft der Dienst. */
const childPath = (parent: string | null, name: string) => (parent ? `${parent}/${name.trim()}` : name.trim());
const parentPath = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);

export async function createFolderAction(parent: string | null, name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#createFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createMediaFolder(deps, ctx, { path: childPath(parent, name) });
    if (result.ok) revalidatePath('/admin/media');
    return toActionState(result, t);
  });
}

/** Benennt einen Ordner um: derselbe Dienst wie Verschieben, mit gleichem Elternordner. */
export async function renameFolderAction(path: string, name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#renameFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await renameMediaFolder(deps, ctx, { from: path, to: childPath(parentPath(path), name) });
    if (result.ok) revalidatePath('/admin/media');
    return toActionState(result, t);
  });
}

/** Verschiebt einen Ordner samt Unterordnern und Dateien unter `toParent` (`null` = oberste Ebene). */
export async function moveFolderAction(from: string, toParent: string | null): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#moveFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const name = from.slice(from.lastIndexOf('/') + 1);
    const result = await renameMediaFolder(deps, ctx, { from, to: childPath(toParent, name) });
    if (result.ok) revalidatePath('/admin/media');
    return toActionState(result, t);
  });
}

/** Löscht einen leeren Ordner, ohne Rückfrage (Spec § 5.4); „Rückgängig“ legt ihn neu an. */
export async function deleteFolderAction(path: string): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#deleteFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteMediaFolder(deps, ctx, { path });
    if (result.ok) revalidatePath('/admin/media');
    return toActionState(result, t);
  });
}

export async function setMediaAiKindAction(id: string, aiKind: AiKind): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#setMediaAiKindAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setMediaAiKind(deps, ctx, { id, aiKind });
    revalidatePath('/admin/media');
    return toActionState(result, t, t('media.aiKindSaved'));
  });
}

/** Was der Dialog „Bildkennzeichnung“ nachträglich zeigt (Fotokachel, Bildfeld): Name, Typ, Art und „Verwendet“. */
export interface MediaLabelingInfo {
  id: string;
  filename: string;
  mimeType: string;
  aiKind: AiKind;
  references: MediaListingItem['references'];
}

export async function getMediaLabelingAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/admin/media/actions.ts#getMediaLabelingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await getMediaAssetInfo(deps, ctx, id);
    if (!result.ok) return toActionState(result, t);
    const { record, references } = result.value;
    const data: MediaLabelingInfo = {
      id: record.id,
      filename: record.filename,
      mimeType: record.mimeType,
      aiKind: aiLabelingEnabled(deps) ? record.aiKind : 'none',
      references: references.map(listingReference),
    };
    return { status: 'success', data };
  });
}
