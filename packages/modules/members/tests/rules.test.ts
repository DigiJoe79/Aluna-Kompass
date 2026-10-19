import { unwrap } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { FINANCE_PERMISSIONS } from '@kompass/module-finance';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMember } from '../src/create-member';
import { setFeeAgreement } from '../src/fee-agreement';
import { previewRecalculation } from '../src/fee-recalc';
import { listFeeSchedules, saveFeeSchedule } from '../src/fee-schedule';
import { deferCharge } from '../src/fees';
import { issueMemberCountCertificate } from '../src/letters/count';
import { admitMember, endMembership, recordApplication, recordResignation, rejectApplication, revokeEnd } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { addressedPerson, auditOf, MEMBERS_PERMISSIONS, person, setupFees } from './helpers';

// TEST_NOW: 2026-10-18 — Plan N1 Task 7 (M2, M5, M9, M12, M33, M30, M4, M10, M11).
const NOW = '2026-10-18T08:00:00.000Z';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const issue = (path: string, message: string) => ({ type: 'validation', issues: [expect.objectContaining({ path, message })] });

async function setup() {
  return setupFees({ now: NOW, validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS, 'dms.view', 'dms.create', 'dms.file'] });
}

describe('Antrag, Aufnahme, Ablehnung (M2, M5)', () => {
  it('an application lies not in the future, nor a birth date; the guardian is someone else', async () => {
    const { deps, ctx, types } = await setup();
    const contactId = await person(deps, 'Antrag');
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2026-11-30' }))).toMatchObject(issue('appliedOn', 'inFuture'));
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2026-10-01', birthDate: '2027-05-01' }))).toMatchObject(issue('birthDate', 'inFuture'));
    expect(fail(await recordApplication(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2026-10-01', guardianContactId: contactId }))).toMatchObject(issue('guardianContactId', 'guardianIsMember'));
    expect(fail(await createMember(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2026-11-30' }))).toMatchObject(issue('appliedOn', 'inFuture'));
  });

  it('admission and rejection lie on or after the application', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await person(deps, 'Folge'), typeId: types.regular, appliedOn: '2026-10-12' }));
    expect(fail(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2026-10-11' }))).toMatchObject(issue('admittedOn', 'beforeApplied'));
    expect(fail(await rejectApplication(deps, ctx, { membershipId: applied.id, rejectedOn: '2026-10-11' }))).toMatchObject(issue('rejectedOn', 'beforeApplied'));
    expect(fail(await admitMember(deps, ctx, { contactId: await person(deps, 'Ohne'), typeId: types.regular, admittedOn: '2026-07-20', appliedOn: '2026-10-18' }))).toMatchObject(issue('admittedOn', 'beforeApplied'));
    expect(fail(await createMember(deps, ctx, { contactId: await person(deps, 'Anlage'), typeId: types.regular, appliedOn: '2026-10-18', admittedOn: '2026-07-20' }))).toMatchObject(issue('admittedOn', 'beforeApplied'));
    expect((await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2026-10-12', letter: false })).ok).toBe(true);
  });
});

describe('Austritt, Ende, Bescheinigung (M9, M10, M11, M12)', () => {
  it('a notice of resignation is not in the future; a second one is refused', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(fail(await recordResignation(deps, ctx, { membershipId: member.id, noticeOn: '2026-10-25' }))).toMatchObject(issue('noticeOn', 'inFuture'));
    unwrap(await recordResignation(deps, ctx, { membershipId: member.id, noticeOn: '2026-10-18' }));
    expect(fail(await recordResignation(deps, ctx, { membershipId: member.id, noticeOn: '2026-10-18' }))).toMatchObject({ type: 'conflict', code: 'resignationExists' });
  });

  it('revoking the end voids the confirmation not yet sent, with an audit entry', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    const resigned = unwrap(await recordResignation(deps, ctx, { membershipId: member.id, noticeOn: '2026-10-18' }));
    const documentId = (resigned.letter as { documentId: string }).documentId;
    unwrap(await revokeEnd(deps, ctx, { membershipId: member.id }));
    expect(deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.status).toBe('voided');
    expect(auditOf(deps, 'members.membership.revokeEnd').at(-1)!.params).toMatchObject({ memberNumber: member.memberNumber, voided: 1 });
  });

  it('an exclusion needs the document of the decision', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(fail(await endMembership(deps, ctx, { membershipId: member.id, endsOn: '2026-12-31', reason: 'exclusion' }))).toMatchObject(issue('documentId', 'required'));
    expect((await endMembership(deps, ctx, { membershipId: member.id, endsOn: '2026-12-31', reason: 'death' })).ok).toBe(true);
  });

  it('the certificate of the number of members is for a day not after today', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await issueMemberCountCertificate(deps, ctx, { date: '2026-12-31' }))).toMatchObject(issue('date', 'inFuture'));
  });
});

describe('Stundung und Beträge (M33, M30)', () => {
  it('a deferral only moves the due day later, and not before today', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.supporting, admittedOn: '2026-10-01', letter: false }));
    const november = deps.db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.membershipId, member.id), eq(memberFeeCharges.periodStart, '2026-11-01'))).get()!;
    expect(fail(await deferCharge(deps, ctx, { chargeId: november.id, dueOn: '2026-10-01' }))).toMatchObject(issue('dueOn', 'deferNotLater'));
    const october = deps.db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.membershipId, member.id), eq(memberFeeCharges.periodStart, '2026-10-01'))).get()!;
    expect(fail(await deferCharge(deps, ctx, { chargeId: october.id, dueOn: '2026-10-10' }))).toMatchObject(issue('dueOn', 'beforeToday'));
    expect((await deferCharge(deps, ctx, { chargeId: november.id, dueOn: '2026-12-15' })).ok).toBe(true);
  });

  it('a fee amount has the same limit as pledges (1.000.000,00 €)', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
    expect(fail(await previewRecalculation(deps, ctx, { membershipId: member.id, from: '2026-01-01', change: { kind: 'agreement', amountCents: 9e15 } }))).toMatchObject({ type: 'validation' });
    expect(fail(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2026-01-01', amountCents: 100_000_001 }))).toMatchObject({ type: 'validation' });
    expect(fail(await saveFeeSchedule(deps, ctx, { validFrom: '2027-01-01', rules: [{ typeId: types.regular, amountCents: 100_000_001, interval: 'yearly' }] }))).toMatchObject({ type: 'validation' });
  });
});

describe('Sperre der Beitragsordnung (M4)', () => {
  it('a schedule is locked once a fee was computed after it, also a yearly fee starting before it', async () => {
    const { deps, ctx, types } = await setup();
    unwrap(await saveFeeSchedule(deps, ctx, { validFrom: '2026-07-20', rules: [{ typeId: types.regular, amountCents: 1500, interval: 'yearly' }] }));
    unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-08-01', letter: false }));
    const schedules = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(schedules.find((s) => s.validFrom === '2026-07-20')).toMatchObject({ locked: true, lockedCount: 1 });
    expect(schedules.find((s) => s.validFrom === '2026-01-01')).toMatchObject({ locked: false, lockedCount: 0 });
  });
});
