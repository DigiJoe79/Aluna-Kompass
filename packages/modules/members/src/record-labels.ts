import { hasPermission, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { periodLabel } from './fee-period';
import { memberFeeCharges, memberMemberships } from './schema';

/**
 * Beschriftung einer Mitgliedschaft für Akte, Wiedervorlagen und die Spalte „Objekt“ im Protokoll: die Nummer, nie der
 * Name. Nicht aus `index.ts` exportieren (MCP-Paritätswächter).
 */
export function membersRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType === 'memberFeeCharge') return feeChargeLabel(deps, ctx, id);
  if (entityType !== 'membership') return null;
  const row = deps.db.select({ memberNumber: memberMemberships.memberNumber }).from(memberMemberships).where(eq(memberMemberships.id, id)).get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'members.read')) return { label: { key: 'members.records.forbidden' }, href: null, state: 'forbidden' };
  const label = row.memberNumber ? { key: 'members.records.member', params: { memberNumber: row.memberNumber } } : { key: 'members.records.application' };
  return { label, name: row.memberNumber ?? '', href: `/members/${id}`, state: 'ok', sensitive: false };
}

/** Herkunft eines offenen Postens der Finanzen (Spec § 6.1): „Beitrag 2027 · Mitglied 0007“, Link zur Mitgliedschaft. */
function feeChargeLabel(deps: Deps, ctx: CallContext, id: string): RecordLabelInput {
  const row = deps.db
    .select({ membershipId: memberFeeCharges.membershipId, periodStart: memberFeeCharges.periodStart, periodEnd: memberFeeCharges.periodEnd, memberNumber: memberMemberships.memberNumber })
    .from(memberFeeCharges)
    .innerJoin(memberMemberships, eq(memberFeeCharges.membershipId, memberMemberships.id))
    .where(eq(memberFeeCharges.id, id))
    .get();
  if (!row) return { label: '', href: null, state: 'missing' };
  if (!hasPermission(ctx, 'members.read')) return { label: { key: 'members.records.forbidden' }, href: null, state: 'forbidden' };
  const period = periodLabel(row.periodStart, row.periodEnd);
  return { label: { key: 'members.records.feeCharge', params: { period, memberNumber: row.memberNumber ?? '' } }, name: `${period} ${row.memberNumber ?? ''}`.trim(), href: `/members/${row.membershipId}`, state: 'ok', sensitive: false };
}
