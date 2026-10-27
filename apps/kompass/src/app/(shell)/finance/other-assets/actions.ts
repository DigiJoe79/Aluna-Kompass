'use server';

import { endOtherAsset, revalueOtherAsset, saveOtherAsset } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions des sonstigen Vermögens (Designer Runde 2, 11d–11h). Je eine Aktion je Dienst; Rechte, Prüfung und
 * Protokoll stehen dort. Die Berichte rechnen mit dem Bestand: auch sie werden neu aufgebaut.
 */
function revalidate(): void {
  revalidatePath('/finance/other-assets');
  revalidatePath('/finance/reports', 'layout');
}

export interface OtherAssetInput {
  id?: string;
  expectedVersion?: string;
  kind: 'asset' | 'liability';
  label: string;
  valueCents: number | null;
  basis: string;
  recordedFrom: string;
  documentId: string | null;
}

/** Feldnamen der Maske für die Pfade des Dienstes (`valueCents` steht im Feld „Wert“). */
function renameFields(state: ActionState): ActionState {
  if (state.status !== 'error' || !('valueCents' in state.fieldErrors)) return state;
  const { valueCents, ...rest } = state.fieldErrors;
  return { ...state, fieldErrors: { ...rest, value: valueCents! } };
}

export async function saveOtherAssetAction(input: OtherAssetInput): Promise<ActionState> {
  return guardAction('(shell)/finance/other-assets/actions.ts#saveOtherAssetAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveOtherAsset(deps, ctx, input);
    revalidate();
    return renameFields(toActionState(result, t, t('finance.otherAssets.dialog.saved')));
  });
}

export async function revalueOtherAssetAction(input: { id: string; from: string; valueCents: number | null; basis: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/other-assets/actions.ts#revalueOtherAssetAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await revalueOtherAsset(deps, ctx, input);
    revalidate();
    return renameFields(toActionState(result, t, t('finance.otherAssets.revalue.done')));
  });
}

export async function endOtherAssetAction(input: { id: string; until: string; reason: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/other-assets/actions.ts#endOtherAssetAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const reason = input.reason.trim();
    const result = await endOtherAsset(deps, ctx, { id: input.id, until: input.until, ...(reason ? { reason } : {}) });
    revalidate();
    return toActionState(result, t, t('finance.otherAssets.end.done'));
  });
}
