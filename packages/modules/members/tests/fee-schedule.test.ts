import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteFeeSchedule, feeRuleAt, listFeeSchedules, saveFeeSchedule } from '../src/fee-schedule';
import { memberFeeCharges, memberMemberships, memberTypes } from '../src/schema';
import { auditOf, setupMembers, type MembersDeps } from './helpers';

// TEST_NOW: 2026-09-05
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const typeId = (deps: MembersDeps, key: string) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, key)).get()!.id;

function rules(deps: MembersDeps, regularCents: number) {
  return [
    { typeId: typeId(deps, 'regular'), amountCents: regularCents, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const] },
    { typeId: typeId(deps, 'supporting'), amountCents: 1000, interval: 'monthly' as const, minimum: true, allowedIntervals: ['monthly' as const, 'yearly' as const] },
  ];
}

async function twoSchedules() {
  const { deps, ctx } = setupMembers();
  const older = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2025-01-01', resolvedOn: '2024-11-20', rules: rules(deps, 1200) }));
  const newer = unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', rules: rules(deps, 1500), note: 'Beschluss der Versammlung' }));
  return { deps, ctx, older, newer };
}

/** Eine angelegte Beitragszeile ab `periodStart`, berechnet nach dem Stand `scheduleId` — macht ihn fest (M4). */
function createdCharge(deps: MembersDeps, periodStart: string, scheduleId: string) {
  const now = '2026-09-05T08:00:00.000Z';
  deps.db.insert(memberMemberships).values({ id: 'M1', contactId: 'C1', memberNumber: '0001', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  deps.db.insert(memberFeeCharges).values({ id: `F-${periodStart}`, membershipId: 'M1', periodStart, periodEnd: `${periodStart.slice(0, 4)}-12-31`, amountCents: 1500, dueOn: periodStart, state: 'created', scheduleId }).run();
}

describe('fee schedules', () => {
  it('lists stands newest first with their rules; feeRuleAt picks the stand of the day', async () => {
    const { deps, ctx } = await twoSchedules();
    const list = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(list.map((s) => s.validFrom)).toEqual(['2026-01-01', '2025-01-01']);
    expect(list[0]!.rules).toHaveLength(2);
    expect(list[0]!.rules.find((r) => r.minimum)!.allowedIntervals).toEqual(['monthly', 'yearly']);
    expect(list.every((s) => !s.locked)).toBe(true);
    const regular = typeId(deps, 'regular');
    expect(feeRuleAt(deps.db, regular, '2025-06-30')!.amountCents).toBe(1200);
    expect(feeRuleAt(deps.db, regular, '2026-01-01')!.amountCents).toBe(1500);
    expect(feeRuleAt(deps.db, regular, '2024-12-31')).toBeNull();
    expect(feeRuleAt(deps.db, typeId(deps, 'honorary'), '2026-03-01')).toBeNull();
  });

  it('audits create and update with the day only', async () => {
    const { deps, ctx, newer } = await twoSchedules();
    unwrap(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: rules(deps, 1800) }));
    expect(auditOf(deps, 'members.feeSchedule.create').map((e) => e.params)).toEqual([{ validFrom: '2025-01-01' }, { validFrom: '2026-01-01' }]);
    expect(auditOf(deps, 'members.feeSchedule.update').map((e) => e.params)).toEqual([{ validFrom: '2026-01-01' }]);
  });

  it('a stand with charges created after it is locked: no change, no delete', async () => {
    const { deps, ctx, newer, older } = await twoSchedules();
    createdCharge(deps, '2026-01-01', newer.id);
    createdCharge(deps, '2025-01-01', older.id);
    const list = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(list.map((s) => s.locked)).toEqual([true, true]);
    expect(fail(await saveFeeSchedule(deps, ctx, { id: newer.id, validFrom: '2026-01-01', rules: rules(deps, 1800) }))).toMatchObject({ type: 'conflict', code: 'feeScheduleLocked', params: { count: 1 } });
    expect(fail(await deleteFeeSchedule(deps, ctx, { id: older.id }))).toMatchObject({ code: 'feeScheduleLocked' });
  });

  it('a new stand next to a locked one is fine; the only stand cannot be deleted', async () => {
    const { deps, ctx, newer, older } = await twoSchedules();
    unwrap(await deleteFeeSchedule(deps, ctx, { id: older.id }));
    expect(auditOf(deps, 'members.feeSchedule.delete').map((e) => e.params)).toEqual([{ validFrom: '2025-01-01' }]);
    expect(fail(await deleteFeeSchedule(deps, ctx, { id: newer.id }))).toMatchObject({ code: 'feeScheduleLast' });
    createdCharge(deps, '2026-01-01', newer.id);
    expect((await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: rules(deps, 1800) })).ok).toBe(true);
  });

  it('refuses a rule for a fee-exempt type, an interval outside the allowed ones and a taken day', async () => {
    const { deps, ctx } = await twoSchedules();
    const honorary = { typeId: typeId(deps, 'honorary'), amountCents: 100, interval: 'yearly' as const, minimum: false, allowedIntervals: ['yearly' as const] };
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: [honorary] }))).toMatchObject({ type: 'validation', issues: [{ path: 'rules.0.typeId', message: 'feeExemptType' }] });
    const odd = { ...rules(deps, 1200)[0]!, allowedIntervals: ['monthly' as const] };
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: [odd] }))).toMatchObject({ type: 'validation' });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2026-01-01', rules: rules(deps, 1200) }))).toMatchObject({ type: 'conflict', code: 'feeScheduleDateTaken' });
  });

  it('needs members.fees to write and members.read to read', async () => {
    const { deps } = setupMembers(['members.read']);
    const { ctx: none } = setupMembers([]);
    expect(fail(await saveFeeSchedule(deps, none, { validFrom: '2027-01-01', rules: [] }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await listFeeSchedules(deps, none, {}))).toMatchObject({ type: 'forbidden' });
  });
});
