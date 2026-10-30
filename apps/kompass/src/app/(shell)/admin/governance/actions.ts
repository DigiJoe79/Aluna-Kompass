'use server';

import { setSetting } from '@kompass/core';
import { adoptRoleRows } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export interface GovernanceSettingsInput {
  deadlineLeadDays?: number;
  registerOverdueDays?: number;
  taxNoticeRequestDays?: number;
  /** Stichtag der Warnung „ordentliche MV fehlt“, `MM-TT`. */
  ordinaryMeetingWarnFrom?: string;
}

const KEYS = { deadlineLeadDays: 'governance.deadlineLeadDays', registerOverdueDays: 'governance.registerOverdueDays', taxNoticeRequestDays: 'governance.taxNoticeRequestDays', ordinaryMeetingWarnFrom: 'governance.ordinaryMeetingWarnFrom' } as const;

/**
 * Einstellungen Gremien (Plan U1 Task 12): je geänderten Schlüssel `setSetting` des Kerns — der prüft
 * `settings.manage` und das Schema. Der erste Fehler hält an.
 */
export async function saveGovernanceSettingsAction(input: GovernanceSettingsInput): Promise<ActionState> {
  return guardAction('(shell)/admin/governance/actions.ts#saveGovernanceSettingsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    for (const [field, key] of Object.entries(KEYS) as [keyof typeof KEYS, string][]) {
      const value = input[field];
      if (value === undefined) continue;
      const result = await setSetting(deps, ctx, { key, value });
      if (!result.ok) {
        revalidatePath('/admin/governance');
        return toActionState(result, t);
      }
    }
    revalidatePath('/admin/governance');
    revalidatePath('/governance/meetings');
    return { status: 'success', message: t('governance.admin.saved') };
  });
}

/** Rollenübernahme (Spec § 3.4): Rollenzeilen von vor Kompass einem Amt zuordnen; der Dienst prüft die Rolle. */
export async function adoptRoleRowsAction(items: { rowId: string; officeId: string }[]): Promise<ActionState> {
  return guardAction('(shell)/admin/governance/actions.ts#adoptRoleRowsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await adoptRoleRows(deps, ctx, { items });
    revalidatePath('/admin/governance');
    revalidatePath('/governance');
    return toActionState(result, t, t('governance.admin.roles.adopted'));
  });
}
