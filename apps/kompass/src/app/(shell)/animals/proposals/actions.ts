'use server';

import { readSetting } from '@kompass/core';
import { getProposal, PROFILE_URL_KEY, publishedRowFor, readProposalImage, rejectProposal, resolveDelistedNotice } from '@kompass/module-animals';
import { buildSinglePage, type SingleAsset } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { acceptWithFollowUp, type AcceptRequest } from './decide';
import { foreignPreviewPhotos, pagePathOf, previewKey, previewRowInput, PROPOSAL_ASSET_PREFIX, type PreviewChoice } from './preview';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const revalidate = () => {
  revalidatePath('/animals', 'layout');
  revalidatePath('/');
};

/** Feldpfade des Dienstes auf die Namen der Maske: `values.name` → `name`, `followUp.dueAt` → `dueAt`. */
function placeFieldErrors(state: ActionState): ActionState {
  if (state.status !== 'error') return state;
  const fieldErrors = Object.fromEntries(Object.entries(state.fieldErrors).map(([path, message]) => [path.replace(/^(values|followUp)\./, ''), message]));
  return { ...state, fieldErrors };
}

/** Annehmen (Spec § 6) über `acceptProposal`, danach die Wiedervorlage; `name` nur für die Meldung. */
export async function acceptProposalAction(input: AcceptRequest, name = ''): Promise<ActionState> {
  return guardAction('(shell)/animals/proposals/actions.ts#acceptProposalAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await acceptWithFollowUp(deps, ctx, input);
    if (!result.ok) return placeFieldErrors(toActionState(result, t));
    revalidate();
    const { animalId, state, followUp } = result.value;
    const key = followUp === 'refused' ? 'doneFollowUpRefused' : state === 'acceptedWithChanges' ? 'doneWithChanges' : 'done';
    return { status: 'success', message: t(`animals.proposals.accept.${key}`, { name }), data: { animalId, state } };
  });
}

export async function rejectProposalAction(id: string, note: string, name = ''): Promise<ActionState> {
  return guardAction('(shell)/animals/proposals/actions.ts#rejectProposalAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await rejectProposal(deps, ctx, { id, note: note.trim() || undefined });
    if (result.ok) revalidate();
    return toActionState(result, t, t('animals.proposals.reject.done', { name }));
  });
}

/** Hinweis „nicht mehr gelistet“: vermittelt, offline, zur Kenntnis genommen — in einem Schritt (Board 5a). */
export async function resolveDelistedAction(id: string, expectedVersion?: string): Promise<ActionState> {
  return guardAction('(shell)/animals/proposals/actions.ts#resolveDelistedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resolveDelistedNotice(deps, ctx, { id, expectedVersion });
    if (!result.ok) return toActionState(result, t);
    revalidate();
    return { status: 'success', data: { steps: result.value.steps } };
  });
}

/**
 * Vorschau der Detailseite eines Hundes für „Heute“ oder „Mit Wahl“ (Board Vorschläge 7b, Spike Plan B): baut die
 * Seite in einem eigenen Ordner, ohne zu speichern, und nennt die Adresse unter `/animals/proposal-preview/`.
 * Recht: `getProposal` verlangt `animals.manage`.
 */
export async function buildProposalPreviewAction(id: string, side: 'current' | 'choice', choice: PreviewChoice): Promise<ActionState> {
  return guardAction('(shell)/animals/proposals/actions.ts#buildProposalPreviewAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const review = await getProposal(deps, ctx, id);
    if (!review.ok) return toActionState(review, t);
    const failed = (key: string): ActionState => ({ status: 'error', message: t(`animals.proposals.preview.${key}`), fieldErrors: {} });
    if (side === 'choice' && foreignPreviewPhotos(review.value, choice)) return failed('invalid');
    const input = previewRowInput(review.value, side, choice);
    let row: { slug: string };
    try {
      row = publishedRowFor(deps, input) as { slug: string };
    } catch {
      return failed('invalid');
    }
    const extraAssets: SingleAsset[] = [];
    for (const imageId of input.proposalImages) {
      const image = await readProposalImage(deps, ctx, { imageId, variant: 'original' });
      if (!image.ok) return toActionState(image, t);
      const meta = review.value.photos?.find((p) => p.imageId === imageId);
      const bytes = image.value.bytes;
      extraAssets.push({ id: `${PROPOSAL_ASSET_PREFIX}${imageId}`, filename: `${PROPOSAL_ASSET_PREFIX}${imageId}.${EXT[image.value.contentType] ?? 'bin'}`, mimeType: image.value.contentType, width: meta?.width ?? null, height: meta?.height ?? null, read: async () => bytes });
    }
    const key = previewKey(id, { side, row, images: input.proposalImages });
    try {
      const built = await buildSinglePage(deps, siteEnv(), { view: 'animals', row, key, extraAssets });
      if (!built.ok) return built.error.type === 'conflict' && built.error.code === 'viewNotInTemplate' ? failed('noAnimalPage') : toActionState(built, t);
    } catch (error) {
      console.error('[site] proposal preview', error);
      return failed('failed');
    }
    return { status: 'success', data: { url: `/animals/proposal-preview/${key}/${pagePathOf(readSetting<string>(deps, PROFILE_URL_KEY) ?? '', row.slug)}` } };
  });
}
