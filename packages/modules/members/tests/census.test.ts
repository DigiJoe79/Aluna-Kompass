import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { countMembersAt, exportMembers } from '../src/census';
import { admitMember, changeMemberType, endMembership, recordApplication } from '../src/memberships';
import { memberTypes } from '../src/schema';
import { auditOf, person, setupMembers, type MembersDeps } from './helpers';

const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const typeId = (deps: MembersDeps, key: string) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, key)).get()!.id;
const D = '2026-06-30';

async function admit(deps: MembersDeps, ctx: ReturnType<typeof setupMembers>['ctx'], lastName: string, joinedOn: string, type = 'regular') {
  const res = await admitMember(deps, ctx, { contactId: await person(deps, lastName), typeId: typeId(deps, type), admittedOn: joinedOn, joinedOn });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.value;
}

/** Review Focus 4: fünf Mitgliedschaften rund um den Stichtag. */
async function fiveAround(deps: MembersDeps, ctx: ReturnType<typeof setupMembers>['ctx']) {
  const joinsOnDay = await admit(deps, ctx, 'Am', D);
  const endsOnDay = await admit(deps, ctx, 'Bis', '2025-01-01', 'supporting');
  await endMembership(deps, ctx, { membershipId: endsOnDay.id, endsOn: D, reason: 'other' });
  await admit(deps, ctx, 'Danach', '2026-07-01');
  const endedBefore = await admit(deps, ctx, 'Davor', '2025-01-01');
  await endMembership(deps, ctx, { membershipId: endedBefore.id, endsOn: '2026-06-29', reason: 'death' });
  await recordApplication(deps, ctx, { contactId: await person(deps, 'Offen'), typeId: typeId(deps, 'regular'), appliedOn: '2026-06-01' });
  return { joinsOnDay, endsOnDay };
}

describe('countMembersAt', () => {
  it('counts a join on the day and an end on the day, not a later join, an earlier end or an application (review focus 4)', async () => {
    const { deps, ctx } = setupMembers();
    await fiveAround(deps, ctx);
    const res = await countMembersAt(deps, ctx, { date: D });
    expect(res.ok && res.value.total).toBe(2);
    expect(res.ok && res.value.byType.map((t) => [t.typeKey, t.count])).toEqual([['regular', 1], ['supporting', 1], ['honorary', 0]]);
    expect(res.ok && res.value.byType[0]!.name).toEqual({ de: 'Ordentliches Mitglied' });
  });

  it('counts a type change before the day under the new type', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admit(deps, ctx, 'Wechsel', '2025-01-01');
    await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'honorary'), validFrom: '2026-06-01' });
    const res = await countMembersAt(deps, ctx, { date: D });
    expect(res.ok && res.value.byType.map((t) => [t.typeKey, t.count])).toEqual([['regular', 0], ['supporting', 0], ['honorary', 1]]);
    const before = await countMembersAt(deps, ctx, { date: '2026-05-31' });
    expect(before.ok && before.value.byType.find((t) => t.typeKey === 'regular')?.count).toBe(1);
  });

  it('needs members.read and a day', async () => {
    const { deps } = setupMembers();
    expect(fail(await countMembersAt(deps, ctxWith(['members.manage']), { date: D }))).toMatchObject({ type: 'forbidden', permission: 'members.read' });
    expect(fail(await countMembersAt(deps, ctxWith(['members.read']), { date: '30.06.2026' }))).toMatchObject({ type: 'validation' });
  });
});

describe('exportMembers', () => {
  it('exports exactly the agreed fields, following the filters, and audits only the count', async () => {
    const { deps, ctx } = setupMembers();
    await fiveAround(deps, ctx);
    const all = await exportMembers(deps, ctx, {});
    expect(all.ok && all.value.total).toBe(5);
    const active = await exportMembers(deps, ctx, { status: ['active'] });
    expect(active.ok && active.value.rows).toEqual([
      { memberNumber: '0001', name: 'Erika Am', type: 'Ordentliches Mitglied', hasVotingRight: true, joinedOn: D, endsOn: null, paymentMethod: null },
      { memberNumber: '0003', name: 'Erika Danach', type: 'Ordentliches Mitglied', hasVotingRight: true, joinedOn: '2026-07-01', endsOn: null, paymentMethod: null },
    ]);
    const searched = await exportMembers(deps, ctx, { search: 'davor' });
    expect(searched.ok && searched.value.rows.map((r) => [r.memberNumber, r.endsOn])).toEqual([['0004', '2026-06-29']]);
    const supporting = await exportMembers(deps, ctx, { typeId: typeId(deps, 'supporting') });
    expect(supporting.ok && supporting.value.rows.map((r) => [r.type, r.hasVotingRight])).toEqual([['Fördermitglied', false]]);

    const audit = auditOf(deps, 'members.export');
    expect(audit).toHaveLength(4);
    expect(audit.at(-1)).toMatchObject({ entityType: 'memberList', entityId: null, params: { count: 1 } });
    expect(JSON.stringify(audit)).not.toContain('Erika');
  });

  it('needs members.read and valid filters', async () => {
    const { deps } = setupMembers();
    expect(fail(await exportMembers(deps, ctxWith(['members.manage']), {}))).toMatchObject({ type: 'forbidden', permission: 'members.read' });
    expect(fail(await exportMembers(deps, ctxWith(['members.read']), { status: ['gone'] }))).toMatchObject({ type: 'validation' });
  });
});
