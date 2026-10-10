'use server';

import { setSetting } from '@kompass/core';
import { PHOTO_FRAME_KEY, PROFILE_URL_KEY, PROPOSAL_PHOTO_FOLDER_KEY, PROPOSAL_STACK_KEY, PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY } from '@kompass/module-animals';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export interface AnimalSettingsValues {
  frame: { aspect: string; focusX: number; focusY: number };
  profileUrl: string;
  proposalsEnabled: boolean;
  reviewOnMcpWrite: boolean;
  photoFolder: string;
  stackEnabled: boolean;
}

/** Nacheinander, Abbruch beim ersten Fehler; der Fehler des Fotoordners steht am Feld `photoFolder`. */
export async function saveAnimalSettingsAction(values: AnimalSettingsValues): Promise<ActionState> {
  return guardAction('(shell)/admin/animals/actions.ts#saveAnimalSettingsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const steps: [string, unknown][] = [
      [PHOTO_FRAME_KEY, values.frame],
      [PROFILE_URL_KEY, values.profileUrl],
      [PROPOSALS_ENABLED_KEY, values.proposalsEnabled],
      [PROPOSAL_STACK_KEY, values.stackEnabled],
      [REVIEW_ON_MCP_WRITE_KEY, values.reviewOnMcpWrite],
      [PROPOSAL_PHOTO_FOLDER_KEY, values.photoFolder],
    ];
    for (const [key, value] of steps) {
      const result = await setSetting(deps, ctx, { key, value });
      if (!result.ok) {
        const state = toActionState(result, t);
        return key === PROPOSAL_PHOTO_FOLDER_KEY && state.status === 'error' ? { ...state, fieldErrors: { photoFolder: state.fieldErrors[''] ?? state.message } } : state;
      }
    }
    revalidatePath('/admin/animals');
    revalidatePath('/animals', 'layout');
    revalidatePath('/');
    return { status: 'success', message: t('animals.admin.saved') };
  });
}
