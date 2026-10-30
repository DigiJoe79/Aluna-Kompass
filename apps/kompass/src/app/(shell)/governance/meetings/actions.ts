'use server';

import { createMeeting, updateMeeting } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Sitzungsliste (Plan U1 Task 4). Jede ruft genau einen Dienst aus `@kompass/module-governance`;
 * Rechte, Prüfungen und Protokoll stehen dort.
 */
const text = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();
const optional = (formData: FormData, key: string) => text(formData, key) || null;

/** Die Kopffelder einer Sitzung aus dem Formular (`MeetingHeadFields`). */
function headOf(formData: FormData) {
  const form = text(formData, 'form') || 'inPerson';
  const remote = form !== 'inPerson';
  return {
    kind: text(formData, 'kind'),
    heldOn: text(formData, 'heldOn'),
    startsAt: text(formData, 'startsAt'),
    form,
    place: optional(formData, 'place'),
    access: remote ? optional(formData, 'access') : null,
    remoteNote: remote ? optional(formData, 'remoteNote') : null,
    repeatOfId: text(formData, 'kind') === 'repeat' ? optional(formData, 'repeatOfId') : null,
    ...(formData.has('plannedChairContactId') ? { plannedChairContactId: optional(formData, 'plannedChairContactId') } : {}),
    ...(formData.has('plannedMinuteTakerContactId') ? { plannedMinuteTakerContactId: optional(formData, 'plannedMinuteTakerContactId') } : {}),
  };
}

export async function createMeetingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/actions.ts#createMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createMeeting(deps, ctx, { organId: text(formData, 'organId'), ...headOf(formData) });
    revalidatePath('/governance/meetings');
    if (!result.ok) return toActionState(result, t);
    redirect(`/governance/meetings/${result.value.id}`);
  });
}

export async function updateMeetingAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/actions.ts#updateMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const id = text(formData, 'id');
    const result = await updateMeeting(deps, ctx, { id, ...headOf(formData) });
    revalidatePath('/governance/meetings');
    revalidatePath(`/governance/meetings/${id}`);
    return toActionState(result, t, t('governance.head.saved'));
  });
}
