import { unwrap, type CallContext } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { financeOpenItems } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { deferCharge, feesForMembership, feeStateOf, listFees, waiveCharge } from '../src/fees';
import { admitMember, deleteMembership, endMembership, recordApplication } from '../src/memberships';
import { contacts, deleteContact } from '@kompass/module-contacts';
import { memberMemberships } from '../src/schema';
import { memberFeeCharges } from '../src/schema';
import { asMcp, auditOf, payOpenItem, person, setupFees, type MembersDeps } from './helpers';

const NOW = '2027-02-10T08:00:00.000Z';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

describe('feeStateOf', () => {
  const charge = { amountCents: 1200, dueOn: '2027-01-01' };
  const item = (settledCents: number, extra: Partial<{ cancelledAt: string; dueOn: string }> = {}) => ({ amountCents: 1200, settledCents, cancelledAt: null, dueOn: '2027-01-01', ...extra });

  it.each([
    ['open, not yet due', item(0, { dueOn: '2027-03-01' }), { state: 'open', overdue: false, openCents: 1200, paidCents: 0 }],
    ['open and overdue', item(0), { state: 'open', overdue: true, openCents: 1200, paidCents: 0 }],
    ['partly paid and overdue', item(500), { state: 'partlyPaid', overdue: true, openCents: 700, paidCents: 500 }],
    ['paid', item(1200), { state: 'paid', overdue: false, openCents: 0, paidCents: 1200 }],
    ['waived', item(0, { cancelledAt: '2027-02-01T10:00:00.000Z' }), { state: 'waived', overdue: false, openCents: 0, paidCents: 0 }],
  ])('%s', (_name, openItem, expected) => {
    expect(feeStateOf(charge, openItem, '2027-02-10')).toEqual(expected);
  });

  it('a charge without open item yet (pending in a run) is open', () => {
    expect(feeStateOf(charge, null, '2026-12-01')).toEqual({ state: 'open', overdue: false, openCents: 1200, paidCents: 0 });
  });
});

async function admit(deps: MembersDeps, ctx: CallContext, typeId: string) {
  return unwrap(await admitMember(deps, ctx, { contactId: await person(deps), typeId, admittedOn: '2026-01-01', joinedOn: '2026-01-01' }));
}

/** Zwei ordentliche Mitglieder (jährlich, fällig 01.01.) und ein Fördermitglied (monatlich), Beitragslauf 2027 durch. */
async function withFees() {
  const env = await setupFees({ now: NOW });
  const { deps, ctx, types } = env;
  const a = await admit(deps, ctx, types.regular);
  const b = await admit(deps, ctx, types.regular);
  const c = await admit(deps, ctx, types.supporting);
  const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
  unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
  const chargeOf = (membershipId: string, periodStart = '2027-01-01') => deps.db.select().from(memberFeeCharges).all().find((x) => x.membershipId === membershipId && x.periodStart === periodStart)!;
  return { ...env, a, b, c, chargeOf };
}

describe('listFees and feesForMembership', () => {
  it('lists one line per fee with state and the sums of the year', async () => {
    const { deps, ctx, a, b, c, chargeOf } = await withFees();
    await payOpenItem(deps, chargeOf(a.id).openItemId!, 1200, '2027-01-20');
    await payOpenItem(deps, chargeOf(b.id).openItemId!, 500, '2027-01-20');
    const list = unwrap(await listFees(deps, ctx, { year: 2027, limit: 200 }));
    expect(list.total).toBe(14);
    expect(list.items[0]).toMatchObject({ memberNumber: a.memberNumber, periodStart: '2027-01-01', amountCents: 1200, paidCents: 1200, openCents: 0, state: 'paid', overdue: false });
    expect(list.items[1]).toMatchObject({ memberNumber: b.memberNumber, state: 'partlyPaid', overdue: true, openCents: 700 });
    expect(list.items.filter((i) => i.membershipId === c.id).map((i) => i.state)).toEqual(Array(12).fill('open'));
    expect(list.totals).toEqual({ dueCents: 2400 + 12000, paidCents: 1700, openCents: 700 + 12000, dunnedCents: 0 });

    expect(unwrap(await listFees(deps, ctx, { year: 2027, onlyArrears: true, limit: 200 })).items.map((i) => [i.memberNumber, i.periodStart])).toEqual([
      [b.memberNumber, '2027-01-01'],
      [c.memberNumber, '2027-01-01'],
      [c.memberNumber, '2027-02-01'],
    ]);
    expect(unwrap(await listFees(deps, ctx, { year: 2027, status: ['paid'], limit: 200 })).total).toBe(1);
    expect(unwrap(await listFees(deps, ctx, { year: 2027, search: c.memberNumber!, limit: 5 })).items).toHaveLength(5);
    expect(unwrap(await listFees(deps, ctx, { year: 2027, status: ['overdue'], limit: 200 })).total).toBe(3);

    const own = unwrap(await feesForMembership(deps, ctx, c.id));
    expect(own.map((f) => f.periodStart)[0]).toBe('2027-12-01');
    expect(own).toHaveLength(12);
  });

  it('needs members.read', async () => {
    const { deps, a } = await withFees();
    expect(fail(await listFees(deps, ctxWith([]), { year: 2027 }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await feesForMembership(deps, ctxWith([]), a.id))).toMatchObject({ type: 'forbidden' });
    expect(fail(await listFees(deps, ctxWith(['members.read']), { year: 'all' }))).toMatchObject({ type: 'validation' });
  });
});

describe('deferCharge and waiveCharge', () => {
  it('deferring moves the due day of the open item and marks the fee', async () => {
    const { deps, ctx, b, chargeOf } = await withFees();
    unwrap(await deferCharge(deps, ctx, { chargeId: chargeOf(b.id).id, dueOn: '2027-06-30' }));
    const charge = chargeOf(b.id);
    expect(charge.deferredTo).toBe('2027-06-30');
    expect(deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId!)).get()!.dueOn).toBe('2027-06-30');
    expect(unwrap(await listFees(deps, ctx, { year: 2027, limit: 200 })).items.find((i) => i.chargeId === charge.id)).toMatchObject({ state: 'open', overdue: false, dueOn: '2027-06-30', deferredTo: '2027-06-30' });
    expect(auditOf(deps, 'members.fee.defer').map((e) => e.params)).toEqual([{ memberNumber: b.memberNumber, dueOn: '2027-06-30' }]);
  });

  it('waiving cancels the open item; a paid fee is not open', async () => {
    const { deps, ctx, a, b, chargeOf } = await withFees();
    unwrap(await waiveCharge(deps, ctx, { chargeId: chargeOf(b.id).id }));
    expect(deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, chargeOf(b.id).openItemId!)).get()!.cancelledAt).not.toBeNull();
    expect(unwrap(await feesForMembership(deps, ctx, b.id))[0]).toMatchObject({ state: 'waived', openCents: 0, waivedCents: 1200 });
    expect(auditOf(deps, 'members.fee.waive').map((e) => e.params)).toEqual([{ memberNumber: b.memberNumber }]);
    expect(fail(await waiveCharge(deps, ctx, { chargeId: chargeOf(b.id).id }))).toMatchObject({ code: 'feeChargeNotOpen' });

    await payOpenItem(deps, chargeOf(a.id).openItemId!, 1200, '2027-01-20');
    expect(fail(await waiveCharge(deps, ctx, { chargeId: chargeOf(a.id).id }))).toMatchObject({ type: 'conflict', code: 'feeChargeNotOpen' });
  });

  it('a partly paid fee: waiving lowers it to the paid amount, paid with the remainder waived; then the membership can go (Plan M4 Task 5b)', async () => {
    const { deps, ctx, a, chargeOf } = await withFees();
    const charge = chargeOf(a.id);
    await payOpenItem(deps, charge.openItemId!, 600, '2027-01-20');
    const waived = unwrap(await waiveCharge(deps, ctx, { chargeId: charge.id }));
    expect(waived).toMatchObject({ state: 'paid', amountCents: 1200, paidCents: 600, openCents: 0, waivedCents: 600, overdue: false });
    expect(deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId!)).get()).toMatchObject({ amountCents: 600, cancelledAt: null });
    expect(auditOf(deps, 'finance.openItem.reduce').map((e) => e.params)).toEqual([{ amountCents: 600 }]);
    expect(auditOf(deps, 'members.fee.waive').map((e) => e.params)).toEqual([{ memberNumber: a.memberNumber }]);

    unwrap(await endMembership(deps, ctx, { membershipId: a.id, endsOn: '2027-03-31', reason: 'other' }));
    deps.clock.set('2029-01-02T08:00:00.000Z');
    expect(unwrap(await deleteMembership(deps, ctx, { membershipId: a.id }))).toEqual({ id: a.id });
  });

  it('both are human only and need members.fees', async () => {
    const { deps, ctx, b, chargeOf } = await withFees();
    const chargeId = chargeOf(b.id).id;
    expect(fail(await deferCharge(deps, asMcp(ctx), { chargeId, dueOn: '2027-06-30' }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await waiveCharge(deps, asMcp(ctx), { chargeId }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await deferCharge(deps, ctxWith(['members.read']), { chargeId, dueOn: '2027-06-30' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await deferCharge(deps, ctx, { chargeId, dueOn: 'später' }))).toMatchObject({ type: 'validation' });
    expect(fail(await waiveCharge(deps, ctx, { chargeId: 'nope' }))).toMatchObject({ type: 'notFound' });
  });
});

describe('deleteMembership with fees', () => {
  it('an open application without fees can be deleted, one with a fee not', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW });
    const clean = unwrap(await recordApplication(deps, ctx, { contactId: await person(deps), typeId: types.regular, appliedOn: '2027-02-01' }));
    expect((await deleteMembership(deps, ctx, { membershipId: clean.id })).ok).toBe(true);
    const odd = unwrap(await recordApplication(deps, ctx, { contactId: await person(deps), typeId: types.regular, appliedOn: '2027-02-01' }));
    deps.db.insert(memberFeeCharges).values({ id: 'F1', membershipId: odd.id, periodStart: '2027-01-01', periodEnd: '2027-12-31', amountCents: 1200, dueOn: '2027-01-01', state: 'pending' }).run();
    expect(fail(await deleteMembership(deps, ctx, { membershipId: odd.id }))).toMatchObject({ type: 'conflict', code: 'membershipHasFees' });
  });
});

describe('deleting a membership with open fees', () => {
  it('is refused while a fee is open — also through deleting the contact; after waiving it can be deleted', async () => {
    const { deps, ctx, b, chargeOf } = await withFees();
    unwrap(await endMembership(deps, ctx, { membershipId: b.id, endsOn: '2027-03-31', reason: 'other' }));
    deps.db.update(contacts).set({ createdAt: '2020-01-01T00:00:00.000Z' }).where(eq(contacts.id, b.contactId)).run();
    deps.clock.set('2031-01-02T08:00:00.000Z');
    expect(fail(await deleteMembership(deps, ctx, { membershipId: b.id }))).toMatchObject({ type: 'conflict', code: 'membershipHasOpenFees', params: { count: 1 } });
    const contactCtx = ctxWith(['contacts.view', 'contacts.manage']);
    expect(fail(await deleteContact(deps, contactCtx, { id: b.contactId }))).toMatchObject({ type: 'conflict', code: 'retentionHoldActive' });

    unwrap(await waiveCharge(deps, ctx, { chargeId: chargeOf(b.id).id }));
    unwrap(await deleteMembership(deps, ctx, { membershipId: b.id }));
    expect(deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, b.id)).get()).toBeUndefined();
  });

  it('a partly paid fee counts as open', async () => {
    const { deps, ctx, b, chargeOf } = await withFees();
    await payOpenItem(deps, chargeOf(b.id).openItemId!, 500, '2027-01-20');
    unwrap(await endMembership(deps, ctx, { membershipId: b.id, endsOn: '2027-03-31', reason: 'other' }));
    deps.clock.set('2031-01-02T08:00:00.000Z');
    expect(fail(await deleteMembership(deps, ctx, { membershipId: b.id }))).toMatchObject({ code: 'membershipHasOpenFees', params: { count: 1 } });
  });
});

