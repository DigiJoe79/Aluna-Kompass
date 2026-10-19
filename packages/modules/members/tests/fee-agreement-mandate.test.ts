import { unwrap, type CallContext } from '@kompass/core';
import { FINANCE_PERMISSIONS, financeSepaMandates, getMandate, prepareMandate } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setFeeAgreement } from '../src/fee-agreement';
import { admitMember } from '../src/memberships';
import { memberFeeAgreements } from '../src/schema';
import { MEMBERS_PERMISSIONS, person, setupFees } from './helpers';

// TEST_NOW: 2026-09-05 — Plan L1 Task 6.
const IBAN = 'DE44999999990532013000';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function setup() {
  const env = await setupFees({ validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS] });
  const ctx: CallContext = env.ctx;
  const contactId = await person(env.deps);
  const membership = unwrap(await admitMember(env.deps, ctx, { contactId, typeId: env.types.regular, admittedOn: '2026-01-01', joinedOn: '2026-01-01', createFees: false }));
  const agreement = (over: Record<string, unknown>) => setFeeAgreement(env.deps, ctx, { membershipId: membership.id, validFrom: '2026-01-01', paymentMethod: 'directDebit', reduction: 'none', ...over });
  return { ...env, ctx, contactId, membership, agreement };
}

describe('setFeeAgreement with direct debit', () => {
  it('without a mandate: IBAN and account holder prepare a pending mandate at the member; without them mandateRequired (Review Focus 5)', async () => {
    const f = await setup();
    expect(fail(await f.agreement({}))).toMatchObject({ type: 'conflict', code: 'mandateRequired' });
    expect(fail(await f.agreement({ iban: IBAN }))).toMatchObject({ code: 'mandateRequired' });
    const saved = unwrap(await f.agreement({ iban: IBAN, debtorName: 'Erika Beispiel' }));
    const mandate = f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, saved.mandateId!)).get()!;
    expect(mandate).toMatchObject({ contactId: f.contactId, iban: IBAN, debtorName: 'Erika Beispiel', signedOn: null });
    // Erneut gespeichert ohne Mandat: die Vereinbarung behält ihres, kein zweites entsteht.
    unwrap(await f.agreement({ amountCents: 1200 }));
    expect(f.deps.db.select().from(financeSepaMandates).all()).toHaveLength(1);
    expect(f.deps.db.select().from(memberFeeAgreements).get()!.mandateId).toBe(mandate.id);
  });

  it('a mandate of another contact is fine (parents of a minor), also prepared for a payer contact', async () => {
    const f = await setup();
    const parent = await person(f.deps, 'Beispiel', 'Paul');
    const theirs = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: parent, debtorName: 'Paul Beispiel', iban: IBAN }));
    expect(unwrap(await f.agreement({ mandateId: theirs.id })).mandateId).toBe(theirs.id);
    const prepared = unwrap(await f.agreement({ validFrom: '2026-07-01', iban: 'DE23999999990000202051', debtorName: 'Paul Beispiel', payerContactId: parent }));
    expect(f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, prepared.mandateId!)).get()!.contactId).toBe(parent);
  });

  it('refuses an ended or expired mandate (mandateNotUsable) and an unknown one', async () => {
    const f = await setup();
    const mandate = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.contactId, debtorName: 'Erika Beispiel', iban: IBAN }));
    f.deps.db.update(financeSepaMandates).set({ signedOn: '2022-01-01' }).where(eq(financeSepaMandates.id, mandate.id)).run();
    expect(fail(await f.agreement({ mandateId: mandate.id }))).toMatchObject({ code: 'mandateNotUsable', params: { reference: 'MND-000001' } });
    expect(fail(await f.agreement({ mandateId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
  });

  it('getMandate names the membership under usedFor', async () => {
    const f = await setup();
    const saved = unwrap(await f.agreement({ iban: IBAN, debtorName: 'Erika Beispiel' }));
    expect(unwrap(await getMandate(f.deps, f.ctx, { id: saved.mandateId! })).usedFor).toEqual([{ kind: 'membership', id: f.membership.id, label: { key: 'members.records.member', params: { memberNumber: f.membership.memberNumber } } }]);
  });

  it('a transfer agreement carries no mandate', async () => {
    const f = await setup();
    expect(unwrap(await f.agreement({ paymentMethod: 'transfer', iban: IBAN, debtorName: 'Erika Beispiel' })).mandateId).toBeNull();
    expect(f.deps.db.select().from(financeSepaMandates).all()).toEqual([]);
  });
});
