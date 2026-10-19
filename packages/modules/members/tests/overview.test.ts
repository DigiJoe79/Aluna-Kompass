import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { setFeeAgreement } from '../src/fee-agreement';
import { admitMember, endMembership, recordApplication, rejectApplication } from '../src/memberships';
import { getMemberFeeDetail, listMemberOverview } from '../src/overview';
import { listFees } from '../src/fees';
import { person, setupFees } from './helpers';

const NOW = '2026-09-01T10:00:00.000Z';

async function setup() {
  const env = await setupFees({ now: NOW, validFrom: '2026-01-01' });
  const { deps, ctx, types } = env;
  const adler = unwrap(await admitMember(deps, ctx, { contactId: await person(deps, 'Adler', 'Tobias'), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
  const brandt = unwrap(await admitMember(deps, ctx, { contactId: await person(deps, 'Brandt', 'Henrik'), typeId: types.supporting, admittedOn: '2026-08-01', createFees: false, letter: false }));
  unwrap(await setFeeAgreement(deps, ctx, { membershipId: brandt.id, validFrom: '2026-08-01', paymentMethod: 'directDebit', iban: 'DE23999999990000202051', debtorName: 'Henrik Brandt' }));
  unwrap(await admitMember(deps, ctx, { contactId: await person(deps, 'Beispiel', 'Erika'), typeId: types.honorary, admittedOn: '2026-01-01', letter: false }));
  unwrap(await recordApplication(deps, ctx, { contactId: await person(deps, 'Kruse', 'Uwe'), typeId: types.regular, appliedOn: '2026-08-20' }));
  const left = unwrap(await admitMember(deps, ctx, { contactId: await person(deps, 'Vogt', 'Nadja'), typeId: types.regular, admittedOn: '2025-01-01', createFees: false, letter: false }));
  unwrap(await endMembership(deps, ctx, { membershipId: left.id, endsOn: '2026-06-30', reason: 'other' }));
  return { ...env, adler, brandt };
}

describe('listMemberOverview', () => {
  it('splits the views and counts each with its own filters', async () => {
    const { deps, ctx } = await setup();
    const res = unwrap(await listMemberOverview(deps, ctx, {}));
    expect(res.items.map((r) => r.contactName)).toEqual(['Erika Beispiel', 'Henrik Brandt', 'Tobias Adler']);
    expect(res.counts).toEqual({ members: 3, applications: 1, left: 1 });
    // „Nur mit Rückstand“ wirkt nur im Reiter „Mitglieder“; die übrigen Zahlen bleiben.
    const arrears = unwrap(await listMemberOverview(deps, ctx, { onlyArrears: true }));
    expect(arrears.counts).toEqual({ members: 1, applications: 1, left: 1 });
  });

  it('shows rejected applications only on request', async () => {
    const { deps, ctx, types } = await setup();
    const rejected = unwrap(await recordApplication(deps, ctx, { contactId: await person(deps, 'Quandt', 'Nora'), typeId: types.regular, appliedOn: '2026-08-01' }));
    unwrap(await rejectApplication(deps, ctx, { membershipId: rejected.id, rejectedOn: '2026-08-15', letter: false }));
    expect(unwrap(await listMemberOverview(deps, ctx, { view: 'applications' })).counts.applications).toBe(1);
    const all = unwrap(await listMemberOverview(deps, ctx, { view: 'applications', includeRejected: true }));
    expect(all.items.map((r) => [r.contactName, r.status])).toEqual([['Nora Quandt', 'rejected'], ['Uwe Kruse', 'applied']]);
    expect(all.counts.applications).toBe(2);
  });

  it('carries fee per year, payment method, mandate and arrears', async () => {
    const { deps, ctx } = await setup();
    const rows = unwrap(await listMemberOverview(deps, ctx, {})).items;
    const [beispiel, brandt, adler] = rows;
    expect(adler).toMatchObject({ yearlyCents: 1200, paymentMethod: 'transfer', exempt: false, arrears: { openCents: 1200, levelKey: null } });
    expect(beispiel).toMatchObject({ yearlyCents: null, paymentMethod: null, exempt: true, arrears: null });
    expect(brandt).toMatchObject({ yearlyCents: 12000, paymentMethod: 'directDebit', mandateState: 'pending' });
    const applications = unwrap(await listMemberOverview(deps, ctx, { view: 'applications' })).items;
    expect(applications.map((r) => [r.contactName, r.yearlyCents])).toEqual([['Uwe Kruse', 1200]]);
  });

  it('filters by payment method and sorts by number', async () => {
    const { deps, ctx } = await setup();
    const dd = unwrap(await listMemberOverview(deps, ctx, { paymentMethod: 'directDebit' }));
    expect(dd.items.map((r) => r.contactName)).toEqual(['Henrik Brandt']);
    const byNumber = unwrap(await listMemberOverview(deps, ctx, { orderBy: { field: 'number', direction: 'desc' } }));
    expect(byNumber.items.map((r) => r.memberNumber)).toEqual(['0003', '0002', '0001']);
  });

  it('needs members.read and a known view', async () => {
    const { deps } = await setup();
    expect(await listMemberOverview(deps, ctxWith(['members.manage']), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listMemberOverview(deps, ctxWith(['members.read']), { view: 'rejected' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('getMemberFeeDetail', () => {
  it('names the fee, the payment method with mandate and the arrears', async () => {
    const { deps, ctx, adler, brandt } = await setup();
    const a = unwrap(await getMemberFeeDetail(deps, ctx, adler.id));
    expect(a).toMatchObject({ fee: { kind: 'fee', amountCents: 1200, interval: 'yearly', source: 'schedule', scheduleValidFrom: '2026-01-01' }, paymentMethod: 'transfer', mandate: null });
    expect(a.arrears).toMatchObject({ openCents: 1200, charges: [{ period: '2026', dueOn: '2026-01-01', openCents: 1200 }], steps: [], lastLevel: false });
    const b = unwrap(await getMemberFeeDetail(deps, ctx, brandt.id));
    expect(b).toMatchObject({ paymentMethod: 'directDebit', mandate: { state: 'pending' }, arrears: null });
  });

  it('needs members.read', async () => {
    const { deps, adler } = await setup();
    expect(await getMemberFeeDetail(deps, ctxWith(['members.fees']), adler.id)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('listFees exempt', () => {
  it('counts the fee-exempt members of the year per type (Handoff 2.4)', async () => {
    const { deps, ctx, types } = await setup();
    const res = unwrap(await listFees(deps, ctx, { year: 2026 }));
    expect(res.exempt).toEqual([{ typeId: types.honorary, count: 1 }]);
  });
});
