import { unwrap, type CallContext } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { prepareMandate } from '../src/direct-debit/mandates';
import { endPledge, savePledge } from '../src/direct-debit/pledges';
import { financeModule } from '../src/manifest';
import { financePledges, financeSepaMandates } from '../src/schema';
import { setupFinance } from './helpers';

// TEST_NOW: 2026-09-05 — Nacharbeit L1: Halter, Löschregeln.
const IBAN = 'DE44999999990532013000';

async function setup() {
  const f = setupFinance();
  const contactCtx: CallContext = { ...f.ctx, permissions: new Set(['contacts.manage']) };
  const payer = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
  const holds = () => [...financeModule.retentionHolds!(f.deps, 'contact', payer.id)].filter((h) => h.entity === 'financeMandate' || h.entity === 'financePledge');
  return { ...f, payer, holds };
}

describe('direct debit holds the contact', () => {
  it('a mandate that is not ended holds without end, labelled by its reference', async () => {
    const f = await setup();
    unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    expect(f.holds()).toEqual([{ label: { key: 'finance.records.mandate', params: { reference: 'MND-000001' } }, until: null, entity: 'financeMandate', id: expect.any(String) }]);
  });

  it('an ended mandate without collection holds 14 months from its end', async () => {
    const f = await setup();
    const m = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    f.deps.db.update(financeSepaMandates).set({ endedOn: '2026-06-30', endReason: 'debtor' }).where(eq(financeSepaMandates.id, m.id)).run();
    expect(f.holds()[0]!.until).toBe('2027-08-30');
  });

  it('an ended mandate with collections holds 14 months from the last one', async () => {
    const f = await setup();
    const m = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    f.deps.db.update(financeSepaMandates).set({ signedOn: '2025-01-10', lastCollectedOn: '2026-03-01', endedOn: '2026-06-30', endReason: 'creditor' }).where(eq(financeSepaMandates.id, m.id)).run();
    expect(f.holds()[0]!.until).toBe('2027-05-01');
  });

  it('a pledge holds while it runs and until its end afterwards', async () => {
    const f = await setup();
    const { pledge } = unwrap(await savePledge(f.deps, f.ctx, { contactId: f.payer.id, amountCents: 1000, interval: 'monthly', firstDueOn: '2026-01-15', paymentMethod: 'transfer' }));
    expect(f.holds()).toEqual([{ label: { key: 'finance.records.pledge' }, until: null, entity: 'financePledge', id: pledge.id }]);
    unwrap(await endPledge(f.deps, f.ctx, { pledgeId: pledge.id, endedOn: '2026-08-31' }));
    expect(f.holds()[0]!.until).toBe('2026-08-31');
  });
});

describe('direct debit records are permanent', () => {
  it('rules mandate and pledge as not deletable, and the database refuses to delete them', async () => {
    const f = await setup();
    const rules = financeModule.deletionRules!.filter((r) => r.entity === 'financeMandate' || r.entity === 'financePledge');
    expect(rules.map((r) => [r.entity, r.deletable])).toEqual([['financeMandate', false], ['financePledge', false]]);
    const m = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    const { pledge } = unwrap(await savePledge(f.deps, f.ctx, { contactId: f.payer.id, amountCents: 1000, interval: 'yearly', firstDueOn: '2026-01-15', paymentMethod: 'transfer' }));
    expect(() => f.deps.db.delete(financePledges).where(eq(financePledges.id, pledge.id)).run()).toThrow(/permanent/);
    expect(() => f.deps.db.delete(financeSepaMandates).where(eq(financeSepaMandates.id, m.id)).run()).toThrow(/permanent/);
  });
});
