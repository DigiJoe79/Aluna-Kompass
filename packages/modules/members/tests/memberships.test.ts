import { writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { contactRoles } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { admitMember, changeMemberType, endMembership, getMembership, listMemberships, membershipForContact, recordApplication, recordResignation, rejectApplication, revokeEnd } from '../src/memberships';
import { formatMemberNumber } from '../src/numbers';
import { memberMemberships, memberTypePeriods, memberTypes } from '../src/schema';
import { setMemberTypeActive, setNextMemberNumber } from '../src/types';
import { asMcp, auditOf, person, setupMembers, type MembersDeps } from './helpers';

// TEST_NOW: 2026-09-05
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const typeId = (deps: MembersDeps, key: string) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, key)).get()!.id;
const memberRoles = (deps: MembersDeps, contactId: string) =>
  deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, contactId)).all().filter((r) => r.role === 'member').map((r) => [r.since, r.until]);

async function applied(deps: MembersDeps, ctx: ReturnType<typeof setupMembers>['ctx'], contactId?: string) {
  const id = contactId ?? (await person(deps));
  const res = await recordApplication(deps, ctx, { contactId: id, typeId: typeId(deps, 'regular'), appliedOn: '2026-03-01' });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.value;
}
async function admitted(deps: MembersDeps, ctx: ReturnType<typeof setupMembers>['ctx'], contactId?: string, admittedOn = '2026-03-15') {
  const app = await applied(deps, ctx, contactId);
  const res = await admitMember(deps, ctx, { membershipId: app.id, admittedOn });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return res.value;
}

describe('formatMemberNumber', () => {
  it('pads to the digits and puts the prefix in front', () => {
    expect(formatMemberNumber(1, { prefix: '', digits: 4 })).toBe('0001');
    expect(formatMemberNumber(1, { prefix: 'M-', digits: 3 })).toBe('M-001');
    expect(formatMemberNumber(12345, { prefix: '', digits: 4 })).toBe('12345');
  });
});

describe('recordApplication', () => {
  it('records an application without number, with its first type period, and audits without values', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const res = await recordApplication(deps, ctx, { contactId, typeId: typeId(deps, 'supporting'), appliedOn: '2026-03-01', birthDate: '2010-04-01', notes: 'Über das Sommerfest' });
    expect(res.ok && res.value).toMatchObject({ status: 'applied', memberNumber: null, typeKey: 'supporting', hasVotingRight: false, contactName: 'Erika Beispiel', birthDate: '2010-04-01' });
    const id = res.ok ? res.value.id : '';
    expect(deps.db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, id)).all().map((p) => p.validFrom)).toEqual(['2026-03-01']);
    expect(auditOf(deps, 'members.membership.apply').at(-1)).toMatchObject({ entityType: 'membership', entityId: id, params: null });
    expect(memberRoles(deps, contactId)).toEqual([]); // die Rolle kommt erst mit der Aufnahme
  });

  it('refuses a second open membership for the same contact (review focus 1)', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    await applied(deps, ctx, contactId);
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: typeId(deps, 'regular'), appliedOn: '2026-04-01' }))).toMatchObject({ type: 'conflict', code: 'membershipRunning' });
    const other = await person(deps, 'Muster');
    const running = await admitted(deps, ctx, other);
    expect(running.status).toBe('active');
    expect(fail(await recordApplication(deps, ctx, { contactId: other, typeId: typeId(deps, 'regular'), appliedOn: '2026-04-01' }))).toMatchObject({ code: 'membershipRunning' });
  });

  it('refuses an inactive type, an unknown contact, a bad date and missing rights', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    await setMemberTypeActive(deps, ctx, { id: typeId(deps, 'honorary'), active: false });
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: typeId(deps, 'honorary'), appliedOn: '2026-03-01' }))).toMatchObject({ type: 'conflict', code: 'memberTypeInactive' });
    expect(fail(await recordApplication(deps, ctx, { contactId: 'NOPE', typeId: typeId(deps, 'regular'), appliedOn: '2026-03-01' }))).toMatchObject({ type: 'notFound', entity: 'contact' });
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: typeId(deps, 'regular'), appliedOn: '1.3.2026' }))).toMatchObject({ type: 'validation' });
    expect(fail(await recordApplication(deps, ctxWith(['members.read']), { contactId, typeId: typeId(deps, 'regular'), appliedOn: '2026-03-01' }))).toMatchObject({ type: 'forbidden', permission: 'members.manage' });
  });
});

describe('admitMember', () => {
  it('admits an application: number, join day, type period from the join day, role member, audit with the number', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const app = await applied(deps, ctx, contactId);
    const res = await admitMember(deps, ctx, { membershipId: app.id, admittedOn: '2026-03-15' });
    expect(res.ok && res.value).toMatchObject({ status: 'active', memberNumber: '0001', admittedOn: '2026-03-15', joinedOn: '2026-03-15', appliedOn: '2026-03-01', typeKey: 'regular' });
    expect(deps.db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, app.id)).all().map((p) => p.validFrom)).toEqual(['2026-03-15']);
    expect(memberRoles(deps, contactId)).toEqual([['2026-03-15', null]]);
    expect(auditOf(deps, 'members.membership.admit').at(-1)?.params).toEqual({ memberNumber: '0001' });
  });

  it('admits without application (founding member) with a join day in the past; contact and type are then required', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const res = await admitMember(deps, ctx, { contactId, typeId: typeId(deps, 'honorary'), admittedOn: '2026-01-05', joinedOn: '2019-05-01', appliedOn: null });
    expect(res.ok && res.value).toMatchObject({ status: 'active', memberNumber: '0001', appliedOn: null, joinedOn: '2019-05-01', typeKey: 'honorary' });
    expect(memberRoles(deps, contactId)).toEqual([['2019-05-01', null]]);
    expect(fail(await admitMember(deps, ctx, { contactId: await person(deps, 'Ohne'), admittedOn: '2026-01-05' }))).toMatchObject({ type: 'validation' });
    expect(fail(await admitMember(deps, ctx, { contactId, typeId: typeId(deps, 'regular'), admittedOn: '2026-01-05' }))).toMatchObject({ code: 'membershipRunning' });
  });

  it('numbers: rejection uses none, re-entry gets a new one, numbers are never reused, the format comes from the setting (review focus 3)', async () => {
    const { deps, ctx } = setupMembers();
    const rejectedApp = await applied(deps, ctx);
    expect((await rejectApplication(deps, ctx, { membershipId: rejectedApp.id, rejectedOn: '2026-03-20' })).ok).toBe(true);
    const contactId = await person(deps, 'Wieder');
    const first = await admitted(deps, ctx, contactId);
    expect(first.memberNumber).toBe('0001');
    await endMembership(deps, ctx, { membershipId: first.id, endsOn: '2026-04-30', reason: 'other' });
    const again = await admitted(deps, ctx, contactId, '2026-06-01');
    expect(again.memberNumber).toBe('0002');
    expect(memberRoles(deps, contactId)).toEqual([['2026-03-15', '2026-04-30'], ['2026-06-01', null]]);
    // zweimal aufnehmen geht nicht
    expect(fail(await admitMember(deps, ctx, { membershipId: again.id, admittedOn: '2026-06-02' }))).toMatchObject({ code: 'membershipNotApplied' });

    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'members.numberFormat', { prefix: 'M-', digits: 3 }));
    expect((await admitted(deps, ctx)).memberNumber).toBe('M-003');
  });

  it('the number set ahead is the next one given', async () => {
    const { deps, ctx } = setupMembers();
    await setNextMemberNumber(deps, ctx, { next: 8 });
    expect((await admitted(deps, ctx)).memberNumber).toBe('0008');
  });

  it('is human only: refused over MCP unless the setting allows it', async () => {
    const { deps, ctx } = setupMembers();
    const app = await applied(deps, ctx);
    expect(fail(await admitMember(deps, asMcp(ctx), { membershipId: app.id, admittedOn: '2026-03-15' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'members.mcpHumanOnlyAllowed', true));
    expect((await admitMember(deps, asMcp(ctx), { membershipId: app.id, admittedOn: '2026-03-15' })).ok).toBe(true);
  });

  it('needs members.manage and a valid day', async () => {
    const { deps, ctx } = setupMembers();
    const app = await applied(deps, ctx);
    expect(fail(await admitMember(deps, ctxWith(['members.read']), { membershipId: app.id, admittedOn: '2026-03-15' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await admitMember(deps, ctx, { membershipId: app.id, admittedOn: 'morgen' }))).toMatchObject({ type: 'validation' });
  });
});

describe('rejectApplication', () => {
  it('rejects an open application only, human only, audited without values', async () => {
    const { deps, ctx } = setupMembers();
    const app = await applied(deps, ctx);
    expect(fail(await rejectApplication(deps, asMcp(ctx), { membershipId: app.id, rejectedOn: '2026-03-20' }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await rejectApplication(deps, ctxWith(['members.read']), { membershipId: app.id, rejectedOn: '2026-03-20' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await rejectApplication(deps, ctx, { membershipId: app.id, rejectedOn: '' }))).toMatchObject({ type: 'validation' });
    const res = await rejectApplication(deps, ctx, { membershipId: app.id, rejectedOn: '2026-03-20' });
    expect(res.ok && res.value).toMatchObject({ status: 'rejected', memberNumber: null });
    expect(auditOf(deps, 'members.membership.reject').at(-1)?.params).toBeNull();
    expect(fail(await rejectApplication(deps, ctx, { membershipId: app.id, rejectedOn: '2026-03-21' }))).toMatchObject({ code: 'membershipNotApplied' });
    // nach der Ablehnung darf ein neuer Antrag kommen
    expect((await recordApplication(deps, ctx, { contactId: app.contactId, typeId: typeId(deps, 'regular'), appliedOn: '2026-05-01' })).ok).toBe(true);
  });
});

describe('changeMemberType', () => {
  it('adds a period from the given day, replaces one on the same day, and audits number and type', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    const res = await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'supporting'), validFrom: '2026-07-01' });
    expect(res.ok && res.value.typeKey).toBe('supporting');
    await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'honorary'), validFrom: '2026-07-01' });
    const periods = deps.db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, m.id)).all();
    expect(periods.map((p) => p.validFrom).sort()).toEqual(['2026-03-15', '2026-07-01']);
    expect(auditOf(deps, 'members.membership.changeType').at(-1)?.params).toEqual({ memberNumber: '0001', typeKey: 'honorary' });
    // eine künftige Periode gilt erst ab ihrem Tag
    const future = await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'regular'), validFrom: '2027-01-01' });
    expect(future.ok && future.value.typeKey).toBe('honorary');
  });

  it('refuses a day before joining, an application, an inactive type and missing rights', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    expect(fail(await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'supporting'), validFrom: '2026-03-14' }))).toMatchObject({ type: 'validation' });
    const app = await applied(deps, ctx);
    expect(fail(await changeMemberType(deps, ctx, { membershipId: app.id, typeId: typeId(deps, 'supporting'), validFrom: '2026-07-01' }))).toMatchObject({ code: 'membershipNotActive' });
    await setMemberTypeActive(deps, ctx, { id: typeId(deps, 'honorary'), active: false });
    expect(fail(await changeMemberType(deps, ctx, { membershipId: m.id, typeId: typeId(deps, 'honorary'), validFrom: '2026-07-01' }))).toMatchObject({ code: 'memberTypeInactive' });
    expect(fail(await changeMemberType(deps, ctxWith(['members.read']), { membershipId: m.id, typeId: typeId(deps, 'supporting'), validFrom: '2026-07-01' }))).toMatchObject({ type: 'forbidden' });
  });
});

describe('recordResignation', () => {
  it('proposes the end from the notice setting, ends the role there and audits number and end', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const m = await admitted(deps, ctx, contactId);
    const res = await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2026-09-01' });
    expect(res.ok && res.value).toMatchObject({ status: 'ending', endReason: 'resignation', endNoticeOn: '2026-09-01', endsOn: '2026-12-31' });
    expect(memberRoles(deps, contactId)).toEqual([['2026-03-15', '2026-12-31']]);
    expect(auditOf(deps, 'members.membership.resign').at(-1)?.params).toEqual({ memberNumber: '0001', endsOn: '2026-12-31' });
  });

  it('takes a given end, refuses an end before joining, an application and missing rights', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    expect(fail(await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2026-09-01', endsOn: '2026-03-01' }))).toMatchObject({ type: 'validation' });
    const res = await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2026-09-01', endsOn: '2026-09-30' });
    expect(res.ok && res.value.endsOn).toBe('2026-09-30');
    const app = await applied(deps, ctx);
    expect(fail(await recordResignation(deps, ctx, { membershipId: app.id, noticeOn: '2026-09-01' }))).toMatchObject({ code: 'membershipNotActive' });
    expect(fail(await recordResignation(deps, ctxWith(['members.read']), { membershipId: m.id, noticeOn: '2026-09-01' }))).toMatchObject({ type: 'forbidden' });
  });
});

describe('endMembership', () => {
  it('ends for another reason, with a decision document, and audits number, reason and end', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const m = await admitted(deps, ctx, contactId);
    const res = await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2026-08-31', reason: 'exclusion', documentId: 'DOC1' });
    expect(res.ok && res.value).toMatchObject({ status: 'ended', endReason: 'exclusion', endsOn: '2026-08-31', endDocumentId: 'DOC1', endNoticeOn: null });
    expect(memberRoles(deps, contactId)).toEqual([['2026-03-15', '2026-08-31']]);
    expect(auditOf(deps, 'members.membership.end').at(-1)?.params).toEqual({ memberNumber: '0001', reason: 'exclusion', endsOn: '2026-08-31' });
  });

  it('refuses an end before joining (review focus 2), an unknown reason and missing rights', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    expect(fail(await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2026-03-14', reason: 'death' }))).toMatchObject({ type: 'validation' });
    expect(fail(await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2026-04-14', reason: 'resignation' }))).toMatchObject({ type: 'validation' });
    expect(fail(await endMembership(deps, ctxWith(['members.read']), { membershipId: m.id, endsOn: '2026-04-14', reason: 'death' }))).toMatchObject({ type: 'forbidden' });
  });
});

describe('revokeEnd', () => {
  it('takes back an end in the future, reopens the role and audits the number', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    const m = await admitted(deps, ctx, contactId);
    await recordResignation(deps, ctx, { membershipId: m.id, noticeOn: '2026-09-01' });
    const res = await revokeEnd(deps, ctx, { membershipId: m.id });
    expect(res.ok && res.value).toMatchObject({ status: 'active', endsOn: null, endReason: null, endNoticeOn: null });
    expect(memberRoles(deps, contactId)).toEqual([['2026-03-15', null]]);
    expect(auditOf(deps, 'members.membership.revokeEnd').at(-1)?.params).toEqual({ memberNumber: '0001', voided: 0 });
  });

  it('refuses after the end has passed and without an end (review focus 2), and without rights', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    expect(fail(await revokeEnd(deps, ctx, { membershipId: m.id }))).toMatchObject({ code: 'membershipEnded' });
    await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2026-09-04', reason: 'other' });
    expect(fail(await revokeEnd(deps, ctx, { membershipId: m.id }))).toMatchObject({ code: 'membershipEnded' });
    expect(fail(await revokeEnd(deps, ctxWith(['members.read']), { membershipId: m.id }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await revokeEnd(deps, ctx, {}))).toMatchObject({ type: 'validation' });
  });
});

describe('reading memberships', () => {
  it('gets one, lists with filters, search in name and number, and pages', async () => {
    const { deps, ctx } = setupMembers();
    const a = await admitted(deps, ctx, await person(deps, 'Ahorn', 'Anna'));
    const b = await admitted(deps, ctx, await person(deps, 'Birke', 'Bruno'));
    await changeMemberType(deps, ctx, { membershipId: b.id, typeId: typeId(deps, 'supporting'), validFrom: '2026-05-01' });
    await applied(deps, ctx, await person(deps, 'Celler', 'Clara'));

    const one = await getMembership(deps, ctx, a.id);
    expect(one.ok && one.value).toMatchObject({ id: a.id, contactName: 'Anna Ahorn', status: 'active' });
    expect(fail(await getMembership(deps, ctx, 'NOPE'))).toMatchObject({ type: 'notFound' });

    const all = await listMemberships(deps, ctx, {});
    expect(all.ok && [all.value.total, all.value.items.map((i) => i.contactName)]).toEqual([3, ['Anna Ahorn', 'Bruno Birke', 'Clara Celler']]);
    const active = await listMemberships(deps, ctx, { status: ['active'] });
    expect(active.ok && active.value.total).toBe(2);
    const supporting = await listMemberships(deps, ctx, { typeId: typeId(deps, 'supporting') });
    expect(supporting.ok && supporting.value.items.map((i) => i.id)).toEqual([b.id]);
    const byName = await listMemberships(deps, ctx, { search: 'birk' });
    expect(byName.ok && byName.value.items.map((i) => i.id)).toEqual([b.id]);
    const byNumber = await listMemberships(deps, ctx, { search: '0001' });
    expect(byNumber.ok && byNumber.value.items.map((i) => i.id)).toEqual([a.id]);
    const page = await listMemberships(deps, ctx, { limit: 1, offset: 1 });
    expect(page.ok && [page.value.total, page.value.items.map((i) => i.id)]).toEqual([3, [b.id]]);
    expect(fail(await listMemberships(deps, ctx, { limit: 500 }))).toMatchObject({ type: 'validation' });
    expect(fail(await listMemberships(deps, ctxWith(['members.manage']), {}))).toMatchObject({ type: 'forbidden', permission: 'members.read' });
  });

  it('for a contact: the one not ended, else the latest, else none', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    expect(await membershipForContact(deps, ctx, contactId)).toEqual({ ok: true, value: null });
    const first = await admitted(deps, ctx, contactId);
    await endMembership(deps, ctx, { membershipId: first.id, endsOn: '2026-04-30', reason: 'other' });
    const ended = await membershipForContact(deps, ctx, contactId);
    expect(ended.ok && ended.value?.id).toBe(first.id);
    deps.clock.set('2026-09-06T08:00:00.000Z');
    const second = await applied(deps, ctx, contactId);
    const now = await membershipForContact(deps, ctx, contactId);
    expect(now.ok && now.value?.id).toBe(second.id);
    expect(fail(await membershipForContact(deps, ctxWith([]), contactId))).toMatchObject({ type: 'forbidden' });
  });
});

describe('the stored row', () => {
  it('keeps the state computed, never stored', async () => {
    const { deps, ctx } = setupMembers();
    const m = await admitted(deps, ctx);
    const row = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, m.id)).get()!;
    expect(Object.keys(row)).not.toContain('status');
  });
});
