import { collectRetentionDue, holdsFor, newId, retentionEnd, retentionMonths, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { contacts, deleteContact } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { admitMember, deleteMembership, endMembership, recordApplication, rejectApplication } from '../src/memberships';
import { membershipRetainUntil, retainUntilOf } from '../src/retention';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { unwrap } from '@kompass/core';
import { membersModule } from '../src/manifest';
import { memberMemberships, memberTypePeriods, memberTypes } from '../src/schema';
import { asMcp, auditOf, payOpenItem, person, setupFees, setupMembers, type MembersDeps } from './helpers';
import { memberFeeCharges } from '../src/schema';

const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const row = { appliedOn: '2026-01-10', admittedOn: '2026-02-01', rejectedOn: null, joinedOn: '2026-02-01', endsOn: null };
const regular = (deps: MembersDeps) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'regular')).get()!.id;
const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);

async function member(deps: MembersDeps, ctx: ReturnType<typeof setupMembers>['ctx'], extra: Record<string, unknown> = {}) {
  const contactId = await person(deps);
  const app = await recordApplication(deps, ctx, { contactId, typeId: regular(deps), appliedOn: '2026-03-01', ...extra });
  if (!app.ok) throw new Error(JSON.stringify(app.error));
  const admitted = await admitMember(deps, ctx, { membershipId: app.value.id, admittedOn: '2026-03-15' });
  if (!admitted.ok) throw new Error(JSON.stringify(admitted.error));
  return { contactId, membership: admitted.value };
}

describe('membershipRetainUntil', () => {
  it('holds while running, then until the end of the year after the end or the rejection', () => {
    expect(membershipRetainUntil(row, [])).toBeNull();
    expect(membershipRetainUntil({ ...row, admittedOn: null, joinedOn: null }, [])).toBeNull(); // offener Antrag
    expect(membershipRetainUntil({ ...row, endsOn: '2027-03-15' }, [])).toBe('2028-12-31');
    expect(membershipRetainUntil({ ...row, admittedOn: null, joinedOn: null, rejectedOn: '2027-02-02' }, [])).toBe('2028-12-31');
  });

  it('an open fee extends to the end of the third year after its due year', () => {
    expect(membershipRetainUntil({ ...row, endsOn: '2027-03-15' }, ['2027-01-01'])).toBe('2030-12-31');
    expect(membershipRetainUntil({ ...row, endsOn: '2027-03-15' }, ['2020-01-01'])).toBe('2028-12-31');
  });
});

describe('holds and due memberships', () => {
  it('holds the contact while the membership runs — the contact cannot be deleted', async () => {
    const { deps, ctx } = setupMembers();
    const { contactId, membership } = await member(deps, ctx);
    expect(holdsFor(deps, 'contact', contactId)).toEqual([{ label: 'members.retention.holdLabel 0001', until: null, entity: 'membership', id: membership.id }]);
    expect(fail(await deleteContact(deps, contactCtx, { id: contactId }))).toMatchObject({ type: 'conflict', code: 'retentionHoldActive' });
  });

  it('labels an application without number', async () => {
    const { deps, ctx } = setupMembers();
    const contactId = await person(deps);
    await recordApplication(deps, ctx, { contactId, typeId: regular(deps), appliedOn: '2026-03-01' });
    expect(holdsFor(deps, 'contact', contactId).map((h) => h.label)).toEqual(['members.retention.applicationLabel']);
  });

  it('keeps the application document as long as the membership, not just its own class', async () => {
    const { deps, ctx } = setupMembers();
    const documentId = newId();
    deps.db.insert(documents).values({ id: documentId, phase: 'issued', direction: 'incoming', sourceKind: 'uploaded', typeKey: 'member-application', number: 'MAN-2026-0001', documentDate: '2026-03-01', createdByUserId: 'U1', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' }).run();
    const { membership } = await member(deps, ctx, { applicationDocumentId: documentId });
    expect(holdsFor(deps, 'document', documentId)).toContainEqual({ label: 'members.retention.holdLabel 0001', until: null, entity: 'membership', id: membership.id });
    // Die eigene Frist der Art (consent) ist längst um — fällig ist der Antrag trotzdem nicht, solange die Mitgliedschaft läuft.
    const ownEnd = retentionEnd('2026-03-01', retentionMonths(deps, 'consent')!);
    deps.clock.set(`${Number(ownEnd.slice(0, 4)) + 1}-02-01T08:00:00.000Z`);
    expect(collectRetentionDue(deps).filter((d) => d.entity === 'document').map((d) => d.id)).toEqual([]);
  });

  it('becomes due after the end of the year after the end, then can be deleted; before that it is refused', async () => {
    const { deps, ctx } = setupMembers();
    const { membership } = await member(deps, ctx);
    await endMembership(deps, ctx, { membershipId: membership.id, endsOn: '2026-08-31', reason: 'death' });
    expect(fail(await deleteMembership(deps, ctx, { membershipId: membership.id }))).toMatchObject({ type: 'conflict', code: 'membershipNotDue', params: { retainUntil: '2027-12-31' } });
    expect(collectRetentionDue(deps).filter((d) => d.entity === 'membership')).toEqual([]);

    deps.clock.set('2028-01-02T08:00:00.000Z');
    expect(collectRetentionDue(deps).filter((d) => d.entity === 'membership')).toEqual([{ entity: 'membership', id: membership.id, label: 'members.retention.holdLabel 0001', dueSince: '2027-12-31', href: `/members/${membership.id}` }]);
    expect(fail(await deleteMembership(deps, asMcp(ctx), { membershipId: membership.id }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await deleteMembership(deps, ctxWith(['members.read']), { membershipId: membership.id }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await deleteMembership(deps, ctx, {}))).toMatchObject({ type: 'validation' });
    expect((await deleteMembership(deps, ctx, { membershipId: membership.id })).ok).toBe(true);
    expect(deps.db.select().from(memberMemberships).all()).toEqual([]);
    expect(deps.db.select().from(memberTypePeriods).all()).toEqual([]);
    expect(auditOf(deps, 'members.membership.delete').at(-1)?.params).toEqual({ memberNumber: '0001' });
  });

  it('a running membership is never due and cannot be deleted', async () => {
    const { deps, ctx } = setupMembers();
    const { membership } = await member(deps, ctx);
    expect(fail(await deleteMembership(deps, ctx, { membershipId: membership.id }))).toMatchObject({ code: 'membershipNotDue', params: { retainUntil: 'none' } });
  });

  it('an open application (recorded by mistake) can be deleted at once; a rejected one waits for its period', async () => {
    const { deps, ctx } = setupMembers();
    const app = await recordApplication(deps, ctx, { contactId: await person(deps), typeId: regular(deps), appliedOn: '2026-03-01' });
    const id = app.ok ? app.value.id : '';
    expect((await deleteMembership(deps, ctx, { membershipId: id })).ok).toBe(true);
    expect(auditOf(deps, 'members.membership.delete').at(-1)?.params).toEqual({ memberNumber: null });

    const other = await recordApplication(deps, ctx, { contactId: await person(deps, 'Zweit'), typeId: regular(deps), appliedOn: '2026-03-01' });
    const otherId = other.ok ? other.value.id : '';
    await rejectApplication(deps, ctx, { membershipId: otherId, rejectedOn: '2026-03-20' });
    expect(fail(await deleteMembership(deps, ctx, { membershipId: otherId }))).toMatchObject({ code: 'membershipNotDue', params: { retainUntil: '2027-12-31' } });
  });

  it('deleting the contact takes its memberships with it, audited', async () => {
    const { deps, ctx } = setupMembers();
    const { contactId, membership } = await member(deps, ctx);
    await endMembership(deps, ctx, { membershipId: membership.id, endsOn: '2026-08-31', reason: 'other' });
    // Der Kontakt ist alt genug, dass auch seine Anlage keine Frist mehr trägt.
    deps.db.update(contacts).set({ createdAt: '2020-01-01T00:00:00.000Z' }).where(eq(contacts.id, contactId)).run();
    deps.clock.set('2028-01-02T08:00:00.000Z');
    expect((await deleteContact(deps, contactCtx, { id: contactId })).ok).toBe(true);
    expect(deps.db.select().from(memberMemberships).all()).toEqual([]);
    expect(auditOf(deps, 'members.membership.delete').at(-1)).toMatchObject({ entityId: membership.id, params: { memberNumber: '0001' } });
  });
});

describe('record labels', () => {
  it('names a membership by its number, an application as such, and nothing without members.read', async () => {
    const { deps, ctx } = setupMembers();
    const { membership } = await member(deps, ctx);
    const labels = membersModule.recordLabels!;
    expect(labels(deps, ctx, 'membership', membership.id)).toEqual({ label: { key: 'members.records.member', params: { memberNumber: '0001' } }, name: '0001', href: `/members/${membership.id}`, state: 'ok', sensitive: false });
    const app = await recordApplication(deps, ctx, { contactId: await person(deps, 'Antrag'), typeId: regular(deps), appliedOn: '2026-03-01' });
    expect(labels(deps, ctx, 'membership', app.ok ? app.value.id : '')).toMatchObject({ label: { key: 'members.records.application' }, name: '', state: 'ok' });
    expect(labels(deps, ctxWith(['contacts.view']), 'membership', membership.id)).toMatchObject({ state: 'forbidden', href: null });
    expect(labels(deps, ctx, 'membership', 'NOPE')).toMatchObject({ state: 'missing' });
    expect(labels(deps, ctx, 'project', membership.id)).toBeNull();
  });
});

describe('deletion rule', () => {
  it('declares memberships deletable after their period', () => {
    expect(membersModule.deletionRules).toContainEqual(expect.objectContaining({ entity: 'membership', deletable: true, auditAction: 'members.membership.delete' }));
  });

  it('humanOnly can be opened by the setting', async () => {
    const { deps, ctx } = setupMembers();
    const app = await recordApplication(deps, ctx, { contactId: await person(deps), typeId: regular(deps), appliedOn: '2026-03-01' });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'members.mcpHumanOnlyAllowed', true));
    expect((await deleteMembership(deps, asMcp(ctx), { membershipId: app.ok ? app.value.id : '' })).ok).toBe(true);
  });
});

describe('retention with open fees (Plan M3)', () => {
  it('an end in 2027 with a fee due 01.01.2027 still open holds until 31.12.2030; paid, the usual year after', async () => {
    const { deps, ctx, types } = await setupFees({ now: '2027-02-10T08:00:00.000Z' });
    const m = unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId: types.regular, admittedOn: '2026-01-01', joinedOn: '2026-01-01' }));
    const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
    unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
    unwrap(await endMembership(deps, ctx, { membershipId: m.id, endsOn: '2027-03-31', reason: 'other' }));
    const row = () => deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, m.id)).get()!;
    expect(retainUntilOf(deps.db, row())).toBe('2030-12-31');
    await payOpenItem(deps, deps.db.select().from(memberFeeCharges).get()!.openItemId!, 1200, '2027-02-05');
    expect(retainUntilOf(deps.db, row())).toBe('2028-12-31');
  });
});

