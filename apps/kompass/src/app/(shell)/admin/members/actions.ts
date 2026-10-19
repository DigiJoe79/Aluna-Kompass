'use server';

import { setSetting } from '@kompass/core';
import { deleteMemberType, saveFeeSchedule, saveMembersSettings, saveMemberType, setMemberTypeActive, setNextMemberNumber } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/** Server Actions der Einstellungen Mitglieder (Plan U1 Task 6) — je ein Dienst aus `@kompass/module-members`. */
function revalidate(): void {
  revalidatePath('/admin/members');
  revalidatePath('/members');
}

export async function saveMemberTypeAction(input: { id?: string; key?: string; name: Record<string, string>; hasVotingRight: boolean; feeExempt: boolean }): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#saveMemberTypeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveMemberType(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('members.admin.types.saved'));
  });
}

export async function setMemberTypeActiveAction(id: string, active: boolean): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#setMemberTypeActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setMemberTypeActive(deps, ctx, { id, active });
    revalidate();
    return toActionState(result, t, t(active ? 'members.admin.types.activated' : 'members.admin.types.deactivated'));
  });
}

export async function deleteMemberTypeAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#deleteMemberTypeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteMemberType(deps, ctx, { id });
    revalidate();
    return toActionState(result, t);
  });
}

export async function saveFeeScheduleAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#saveFeeScheduleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveFeeSchedule(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('members.admin.schedule.saved'));
  });
}

/**
 * Speichert die Einstellungen eines Panels. Plan U4 Task 1: Mit `agent` (nur wenn geändert) geht der Agentenschalter
 * mit — erst, wenn die Felder gespeichert sind, und über `setSetting`, das `settings.manage` und den Kanal prüft (die
 * Einstellung ist `uiOnly`) und das Protokoll schreibt.
 */
export async function saveMembersSettingsAction(input: unknown, message: 'numbers' | 'dunning', agent?: boolean): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#saveMembersSettingsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveMembersSettings(deps, ctx, input);
    if (result.ok && agent !== undefined) {
      const switched = await setSetting(deps, ctx, { key: 'members.mcpHumanOnlyAllowed', value: agent });
      if (!switched.ok) {
        revalidate();
        return toActionState(switched, t);
      }
    }
    revalidate();
    return toActionState(result, t, t(message === 'numbers' ? 'members.admin.numbers.saved' : 'members.admin.dunning.saved'));
  });
}

export async function setNextMemberNumberAction(next: number): Promise<ActionState> {
  return guardAction('(shell)/admin/members/actions.ts#setNextMemberNumberAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setNextMemberNumber(deps, ctx, { next });
    revalidate();
    return toActionState(result, t);
  });
}
