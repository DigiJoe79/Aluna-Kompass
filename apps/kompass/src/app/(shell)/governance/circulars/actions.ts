'use server';

import { createCircular, decideCircular, saveCircularResponse, sealCircular } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const revalidate = (id?: string) => {
  revalidatePath('/governance/circulars');
  revalidatePath('/governance/resolutions');
  revalidatePath('/governance');
  if (id) revalidatePath(`/governance/circulars/${id}`);
};

export async function createCircularAction(input: { organId: string; kind: string; text: string; details?: unknown; requestedOn: string; deadline: string; channel: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/circulars/actions.ts#createCircularAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createCircular(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('governance.circular.created'));
  });
}

export async function saveCircularResponseAction(circularId: string, input: { id: string; answer: string; answeredOn: string | null; documentId: string | null; note: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/circulars/actions.ts#saveCircularResponseAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveCircularResponse(deps, ctx, input);
    revalidate(circularId);
    return toActionState(result, t, t('governance.circular.responseSaved'));
  });
}

/**
 * „Beschluss eintragen“: feststellen, dann festschreiben (nur hier in Kompass). Scheitert erst das Festschreiben, bleibt
 * der Umlauf festgestellt; ein zweiter Versuch stellt erneut fest und schreibt fest.
 */
export async function decideAndSealCircularAction(input: { id: string; outcome: 'adopted' | 'rejected'; outcomeReason: string | null; decidedOn: string; decidedByContactId: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/circulars/actions.ts#decideAndSealCircularAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const decided = await decideCircular(deps, ctx, input);
    if (!decided.ok) return toActionState(decided, t);
    const sealed = await sealCircular(deps, ctx, { circularId: input.id });
    revalidate(input.id);
    if (!sealed.ok) return toActionState(sealed, t);
    const number = sealed.value.resolution.number ?? '';
    return { status: 'success', message: t('governance.circular.sealed', { number }), data: sealed.value };
  });
}
