import { unwrap, type CallContext } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { effectiveFee, setFeeAgreement } from '../src/fee-agreement';
import { saveFeeSchedule } from '../src/fee-schedule';
import { admitMember } from '../src/memberships';
import { memberFeeAgreements, memberTypes } from '../src/schema';
import { saveMemberType } from '../src/types';
import { auditOf, person, setupMembers, type MembersDeps } from './helpers';

// TEST_NOW: 2026-09-05
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const typeId = (deps: MembersDeps, key: string) => deps.db.select().from(memberTypes).where(eq(memberTypes.key, key)).get()!.id;

async function member(deps: MembersDeps, ctx: CallContext, type: string, joinedOn = '2026-01-01') {
  return unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId: typeId(deps, type), admittedOn: joinedOn, joinedOn, createFees: false }));
}

async function withSchedule() {
  const { deps, ctx } = setupMembers();
  unwrap(
    await saveFeeSchedule(deps, ctx, {
      validFrom: '2026-01-01',
      rules: [
        { typeId: typeId(deps, 'regular'), amountCents: 1200, interval: 'yearly', minimum: false, allowedIntervals: ['yearly'] },
        { typeId: typeId(deps, 'supporting'), amountCents: 1000, interval: 'monthly', minimum: true, allowedIntervals: ['monthly', 'yearly'] },
      ],
    }),
  );
  return { deps, ctx };
}

describe('setFeeAgreement', () => {
  it('a supporting member below the minimum is refused, unless reduced', async () => {
    const { deps, ctx } = await withSchedule();
    const m = await member(deps, ctx, 'supporting');
    const below = { membershipId: m.id, validFrom: '2026-01-01', amountCents: 800, paymentMethod: 'transfer', reduction: 'none' };
    expect(fail(await setFeeAgreement(deps, ctx, below))).toMatchObject({ type: 'conflict', code: 'feeBelowMinimum', params: { minimumCents: 1000 }, amounts: ['minimumCents'] });
    expect((await setFeeAgreement(deps, ctx, { ...below, reduction: 'reduced' })).ok).toBe(true);
  });

  it('refuses an interval the rule does not allow', async () => {
    const { deps, ctx } = await withSchedule();
    const m = await member(deps, ctx, 'supporting');
    expect(fail(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: '2026-01-01', interval: 'quarterly', paymentMethod: 'transfer', reduction: 'none' }))).toMatchObject({ code: 'intervalNotAllowed' });
  });

  it('one agreement per day: the same day replaces; audit names the member number and the day, nothing else', async () => {
    const { deps, ctx } = await withSchedule();
    const m = await member(deps, ctx, 'supporting');
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: '2026-01-01', amountCents: 2000, paymentMethod: 'transfer', reduction: 'none' }));
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: '2026-01-01', amountCents: 2500, interval: 'yearly', paymentMethod: 'transfer', reduction: 'none' }));
    expect(deps.db.select().from(memberFeeAgreements).all().map((a) => a.amountCents)).toEqual([2500]);
    expect(auditOf(deps, 'members.feeAgreement.set').map((e) => e.params)).toEqual([
      { memberNumber: m.memberNumber, validFrom: '2026-01-01' },
      { memberNumber: m.memberNumber, validFrom: '2026-01-01' },
    ]);
  });

  it('needs members.fees and a valid input', async () => {
    const { deps, ctx } = await withSchedule();
    const m = await member(deps, ctx, 'regular');
    expect(fail(await setFeeAgreement(deps, { ...ctx, permissions: new Set(['members.read']) }, { membershipId: m.id, validFrom: '2026-01-01', paymentMethod: 'transfer', reduction: 'none' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: 'gestern', paymentMethod: 'cash', reduction: 'none' }))).toMatchObject({ type: 'validation' });
    expect(fail(await setFeeAgreement(deps, ctx, { membershipId: 'nope', validFrom: '2026-01-01', paymentMethod: 'transfer', reduction: 'none' }))).toMatchObject({ type: 'notFound' });
  });
});

describe('effectiveFee', () => {
  it('takes the agreement before the schedule, from its day on', async () => {
    const { deps, ctx } = await withSchedule();
    const m = await member(deps, ctx, 'supporting');
    expect(effectiveFee(deps.db, m.id, '2026-03-01')).toEqual({ amountCents: 1000, interval: 'monthly', paymentMethod: 'transfer', exempt: false, source: 'schedule' });
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: m.id, validFrom: '2026-07-01', amountCents: 15000, interval: 'yearly', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Beispiel', reduction: 'none' }));
    expect(effectiveFee(deps.db, m.id, '2026-06-30')).toMatchObject({ amountCents: 1000, source: 'schedule' });
    expect(effectiveFee(deps.db, m.id, '2026-07-01')).toEqual({ amountCents: 15000, interval: 'yearly', paymentMethod: 'directDebit', exempt: false, source: 'agreement' });
  });

  it('a fee-exempt type is exempt; a type without rule has none; no schedule at all is noSchedule', async () => {
    const { deps, ctx } = await withSchedule();
    expect(effectiveFee(deps.db, (await member(deps, ctx, 'honorary')).id, '2026-03-01')).toMatchObject({ exempt: true });
    const youth = unwrap(await saveMemberType(deps, ctx, { key: 'youth', name: { de: 'Jugend' }, hasVotingRight: false, feeExempt: false }));
    const young = unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId: youth.id, admittedOn: '2026-01-01', createFees: false }));
    expect(effectiveFee(deps.db, young.id, '2026-03-01')).toEqual({ none: 'noRule' });
    expect(effectiveFee(deps.db, (await member(deps, ctx, 'regular')).id, '2025-12-31')).toEqual({ none: 'noSchedule' });
  });
});
