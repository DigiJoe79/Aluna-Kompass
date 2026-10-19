import { nameOrEmpty, ok, readLocales, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type LocalizedText, type Result } from '@kompass/core';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { filterMemberships, membershipListSchema, periodAt } from './memberships';
import { memberOverviewRowsInternal } from './overview';
import { memberMemberships, memberTypePeriods, memberTypes, type PaymentMethod } from './schema';

export const membersExportSchema = membershipListSchema.omit({ limit: true, offset: true });
export const membersCountSchema = z.object({ date: z.iso.date() });

/** Eine Zeile der Mitgliederliste (Spec § 3.4): ohne Anschrift, Bankdaten und Beiträge. */
export interface MemberExportRow {
  /** Leer bei einem Antrag. */
  memberNumber: string | null;
  name: string;
  type: string;
  hasVotingRight: boolean;
  joinedOn: string | null;
  endsOn: string | null;
  /** Zahlweg der geltenden Vereinbarung; leer bei beitragsfreien Mitgliedern und ohne Regel. */
  paymentMethod: PaymentMethod | null;
}

/** Die gefilterte Liste wie auf dem Bildschirm, ohne Grenze. Im Protokoll steht nur die Zahl der Zeilen. */
export async function exportMembers(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ rows: MemberExportRow[]; total: number }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, membersExportSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const leading = readLocales(deps)[0]!;
  const names = new Map(deps.db.select().from(memberTypes).all().map((t) => [t.id, nameOrEmpty(t.name[leading])]));
  const rows: MemberExportRow[] = memberOverviewRowsInternal(deps.db, deps, filterMemberships(deps, parsed.value)).map((v) => ({
    memberNumber: v.memberNumber,
    name: v.contactName,
    type: names.get(v.typeId) ?? nameOrEmpty(undefined),
    hasVotingRight: v.hasVotingRight,
    joinedOn: v.joinedOn,
    endsOn: v.endsOn,
    paymentMethod: v.paymentMethod,
  }));
  return deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, { action: 'members.export', entityType: 'memberList', entityId: null, params: { count: rows.length } });
    return ok({ rows, total: rows.length });
  });
}

/**
 * Zahl der Mitglieder zum Stichtag, gesamt und je Art (Art nach der Periode am Stichtag). Es zählt, wer an diesem Tag
 * Mitglied war: eingetreten bis dahin, Ende frühestens an diesem Tag (die Mitgliedschaft endet mit Ablauf ihres
 * letzten Tages). Anträge und Ablehnungen zählen nie.
 */
export async function countMembersAt(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberCount>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, membersCountSchema, input);
  if (!parsed.ok) return parsed;
  return ok(countMembersAtInternal(deps, parsed.value.date));
}

export interface MemberCount {
  date: string;
  total: number;
  byType: { typeId: string; typeKey: string; name: LocalizedText; count: number }[];
}

/** Die Zählung ohne Rechteprüfung — für die Bescheinigung über die Mitgliederzahl (`members.manage`). */
export function countMembersAtInternal(deps: Deps, date: string): MemberCount {
  const periods = deps.db.select().from(memberTypePeriods).all();
  const counts = new Map<string, number>();
  for (const row of deps.db.select().from(memberMemberships).all()) {
    if (!row.admittedOn || row.rejectedOn || !row.joinedOn || row.joinedOn > date) continue;
    if (row.endsOn && row.endsOn < date) continue;
    const period = periodAt(periods.filter((p) => p.membershipId === row.id), date);
    if (period) counts.set(period.typeId, (counts.get(period.typeId) ?? 0) + 1);
  }
  const byType = deps.db
    .select()
    .from(memberTypes)
    .orderBy(asc(memberTypes.sortOrder), asc(memberTypes.key))
    .all()
    .map((t) => ({ typeId: t.id, typeKey: t.key, name: t.name, count: counts.get(t.id) ?? 0, active: t.active }))
    .filter((t) => t.active || t.count > 0)
    .map(({ active: _active, ...t }) => t);
  return { date, total: byType.reduce((sum, t) => sum + t.count, 0), byType };
}
