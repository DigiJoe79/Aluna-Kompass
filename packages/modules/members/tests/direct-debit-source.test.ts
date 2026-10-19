import { schema, unwrap } from '@kompass/core';
import { FINANCE_PERMISSIONS, financeOpenItems, financeSepaMandates } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setFeeAgreement } from '../src/fee-agreement';
import { deferCharge } from '../src/fees';
import { membersModule } from '../src/manifest';
import { admitMember } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { MEMBERS_PERMISSIONS, payOpenItem, person, setupFees } from './helpers';

// TEST_NOW: 2026-09-05 — Plan L2 Task 1: der Haken `directDebitSources`.
const IBAN = 'DE44999999990532013000';

async function setup() {
  const env = await setupFees({ validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS] });
  const admit = async (lastName: string) => {
    const contactId = await person(env.deps, lastName);
    return unwrap(await admitMember(env.deps, env.ctx, { contactId, typeId: env.types.regular, admittedOn: '2026-01-01', joinedOn: '2026-01-01' }));
  };
  const directDebit = async (membershipId: string, debtorName: string) =>
    unwrap(await setFeeAgreement(env.deps, env.ctx, { membershipId, validFrom: '2026-01-01', paymentMethod: 'directDebit', reduction: 'none', iban: IBAN, debtorName }));
  const sources = (until: string) => [...(membersModule.directDebitSources?.(env.deps, { until }) ?? [])];
  const chargeOf = (membershipId: string) => env.deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, membershipId)).get()!;
  return { ...env, admit, directDebit, sources, chargeOf };
}

describe('directDebitSources (members)', () => {
  it('delivers the open fee of a direct-debit member with its mandate, amount, due day and payment reference', async () => {
    const f = await setup();
    const member = await f.admit('Lastschrift');
    const agreement = await f.directDebit(member.id, 'Erika Lastschrift');
    await f.admit('Überweisung');
    const charge = f.chargeOf(member.id);
    expect(f.sources('2026-12-31')).toEqual([{ openItemId: charge.openItemId, mandateId: agreement.mandateId, amountCents: 1200, dueOn: charge.dueOn, remittance: `Beitrag 2026 Mitglied ${member.memberNumber}` }]);
  });

  it('leaves out what is due after the day, what is paid and what is deferred beyond the day', async () => {
    const f = await setup();
    const member = await f.admit('Lastschrift');
    await f.directDebit(member.id, 'Erika Lastschrift');
    const charge = f.chargeOf(member.id);
    expect(f.sources(charge.dueOn)).toHaveLength(1);
    const dayBefore = new Date(Date.parse(`${charge.dueOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(f.sources(dayBefore)).toEqual([]);

    unwrap(await deferCharge(f.deps, f.ctx, { chargeId: charge.id, dueOn: '2026-11-30' }));
    expect(f.sources('2026-11-29')).toEqual([]);
    expect(f.sources('2026-11-30')).toMatchObject([{ dueOn: '2026-11-30' }]);

    await payOpenItem(f.deps, charge.openItemId!, 1200, '2026-09-01');
    expect(f.sources('2026-12-31')).toEqual([]);
  });

  it('delivers a partly paid fee with the rest only', async () => {
    const f = await setup();
    const member = await f.admit('Lastschrift');
    await f.directDebit(member.id, 'Erika Lastschrift');
    await payOpenItem(f.deps, f.chargeOf(member.id).openItemId!, 500, '2026-09-01');
    expect(f.sources('2026-12-31')).toMatchObject([{ amountCents: 700 }]);
  });

  it('names the mandate whatever its state — whether it may be collected, the run decides and says why not', async () => {
    const f = await setup();
    const member = await f.admit('Lastschrift');
    const agreement = await f.directDebit(member.id, 'Erika Lastschrift');
    f.deps.db.update(financeSepaMandates).set({ signedOn: '2026-01-01', endedOn: '2026-06-30', endReason: 'debtor' }).where(eq(financeSepaMandates.id, agreement.mandateId!)).run();
    expect(f.sources('2026-12-31')).toMatchObject([{ mandateId: agreement.mandateId }]);
  });

  it('directDebitWaive (Plan L3): waives the fee of the open item a return reopened, the way of waiveCharge; another item is not ours', async () => {
    const f = await setup();
    const member = await f.admit('Lastschrift');
    await f.directDebit(member.id, 'Erika Lastschrift');
    const charge = f.chargeOf(member.id);
    const waive = (openItemId: string) => f.deps.db.transaction((tx) => membersModule.directDebitWaive!(tx, f.deps, f.ctx, openItemId));
    expect(waive('NOT-OURS')).toBeNull();
    expect(waive(charge.openItemId!)).toMatchObject({ ok: true });
    expect(f.deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId!)).get()!.cancelledAt).not.toBeNull();
    expect(f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'members.fee.waive')).all()).toHaveLength(1);
    expect(f.sources('2026-12-31')).toEqual([]);
  });
});
