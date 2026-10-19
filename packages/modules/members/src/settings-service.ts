import { ok, readSetting, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';
import { MembersAborted, catchAborted } from './errors';
import { lastMemberNumber } from './numbers';
import { dunningLevelSchema, dunningLevelsSchema, resignationNoticeSchema, type DunningLevel, type MemberNumberFormat, type ResignationNotice } from './settings';
import type { JoinYearRule } from './fee-calc';

/** Die Einstellungen der Mitglieder, die „Nummern und Fristen“ und „Mahnstufen“ pflegen (Handoff 2.6, Nachtrag Phase 2 § 0). */
export interface MembersSettingsView {
  nextNumber: number;
  numberFormat: MemberNumberFormat;
  resignationNotice: ResignationNotice;
  joinYearRule: JoinYearRule;
  paymentTermDays: number;
  dunningLevels: DunningLevel[];
}

export const membersSettingsSaveSchema = z.object({
  resignationNotice: resignationNoticeSchema.optional(),
  joinYearRule: z.enum(['full', 'proRataMonths', 'nextYear']).optional(),
  paymentTermDays: z.number().int().min(1).max(90).optional(),
  dunningLevels: dunningLevelsSchema.optional(),
});

/** Für Agenten ohne die Prüfung auf doppelte Schlüssel — die macht der Dienst (MCP-Schemas ohne bedingte Pflicht, N5). */
export const membersSettingsSaveMcpSchema = membersSettingsSaveSchema.extend({ dunningLevels: z.array(dunningLevelSchema).min(1).max(6).optional() });

const KEYS = { resignationNotice: 'members.resignationNotice', joinYearRule: 'members.joinYearRule', paymentTermDays: 'members.paymentTermDays', dunningLevels: 'members.dunningLevels' } as const;

/** Lesen (`members.read`). */
export async function getMembersSettings(deps: Deps, ctx: CallContext): Promise<Result<MembersSettingsView>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  return ok({
    nextNumber: lastMemberNumber(deps.db) + 1,
    numberFormat: readSetting<MemberNumberFormat>(deps, 'members.numberFormat'),
    resignationNotice: readSetting<ResignationNotice>(deps, 'members.resignationNotice'),
    joinYearRule: readSetting<JoinYearRule>(deps, 'members.joinYearRule'),
    paymentTermDays: readSetting<number>(deps, 'members.paymentTermDays'),
    dunningLevels: readSetting<DunningLevel[]>(deps, 'members.dunningLevels'),
  });
}

/**
 * Kündigungsfrist, Beitrag im Eintrittsjahr, Zahlungsziel und Mahnstufen speichern (`members.fees`) — wer Beiträge
 * verwaltet, stellt sie ein, nicht nur, wer alle Einstellungen darf. Je Schlüssel ein Eintrag im Protokoll.
 */
export async function saveMembersSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembersSettingsView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, membersSettingsSaveSchema, input);
  if (!parsed.ok) return parsed;
  const saved = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      for (const [field, key] of Object.entries(KEYS) as [keyof typeof KEYS, string][]) {
        const value = parsed.value[field];
        if (value === undefined) continue;
        const written = writeSettingInternal(tx, deps, ctx, key, value, 'members.setting.set');
        if (!written.ok) throw new MembersAborted(written);
      }
      return ok(null);
    }),
  );
  if (!saved.ok) return saved;
  return getMembersSettings(deps, ctx);
}
