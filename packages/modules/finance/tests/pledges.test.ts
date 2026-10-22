import { schema, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { documentLinks, documents } from '@kompass/module-dms';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getMandate, prepareMandate } from '../src/direct-debit/mandates';
import { endPledge, getPledge, listPledges, pausePledge, savePledge } from '../src/direct-debit/pledges';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeOpenItems, financePledges, financeSepaMandates } from '../src/schema';
import { setupFinance } from './helpers';

// TEST_NOW: 2026-09-05
const IBAN = 'DE44999999990532013000';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const PERMS = [...FINANCE_PERMISSIONS, 'dms.create'];

async function setup(permissions: readonly string[] = PERMS) {
  const f = setupFinance(permissions);
  const write = (key: string, value: unknown) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value));
  f.deps.db.transaction((tx) => installFinance(tx, f.deps, systemContext()));
  write('organization.name', 'Musterverein e.V.');
  write('finance.sepa.creditorId', 'DE98ZZZ09999999999');
  const contactCtx: CallContext = { ...f.ctx, permissions: new Set(['contacts.manage']) };
  const donor = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' }));
  const base = { contactId: donor.id, amountCents: 1000, interval: 'monthly', firstDueOn: '2026-10-15' };
  return { ...f, write, donor, base };
}

describe('savePledge', () => {
  it('with IBAN and account holder prepares a pending mandate and a prenotification draft (Handoff 1.5)', async () => {
    const f = await setup();
    const saved = unwrap(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit', iban: IBAN, debtorName: 'Erika Beispiel' }));
    expect(saved.pledge).toMatchObject({ amountCents: 1000, interval: 'monthly', paymentMethod: 'directDebit', state: 'active', mandate: { reference: 'MND-000001', state: 'pending' } });
    const mandate = unwrap(await getMandate(f.deps, f.ctx, { id: saved.pledge.mandate!.id }));
    expect(mandate).toMatchObject({ contactId: f.donor.id, iban: IBAN, usedFor: [{ kind: 'pledge', id: saved.pledge.id }] });
    const draft = f.deps.db.select().from(documents).where(eq(documents.id, saved.prenotificationDraftId!)).get()!;
    expect(draft).toMatchObject({ phase: 'draft', typeKey: 'sepa-prenotification', subject: 'Lastschriftankündigung zum Mandat MND-000001' });
    expect(draft.draftBody).toContain('Sehr geehrte Frau Beispiel,');
    expect(draft.draftBody).toContain('| Mandatsreferenz | MND-000001 |');
    expect(draft.draftBody).toContain('| Erster Einzug | 15.10.2026 |');
    const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, draft.id)).all();
    expect(links.map((l) => [l.entityType, l.role]).sort()).toEqual([['contact', 'recipient'], ['financeMandate', 'about']]);
  });

  it('never creates an open item for a rate (anti-goal of the spec)', async () => {
    const f = await setup();
    unwrap(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit', iban: IBAN, debtorName: 'Erika Beispiel' }));
    unwrap(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'transfer' }));
    expect(f.deps.db.select().from(financeOpenItems).all()).toEqual([]);
  });

  it('direct debit without a mandate and without IBAN → mandateRequired; an ended mandate → mandateNotUsable', async () => {
    const f = await setup();
    expect(fail(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit' }))).toMatchObject({ code: 'mandateRequired' });
    expect(fail(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit', iban: IBAN }))).toMatchObject({ code: 'mandateRequired' });
    const mandate = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: f.donor.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    expect((await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit', mandateId: mandate.id })).ok).toBe(true);
    f.deps.db.update(financeSepaMandates).set({ endedOn: '2026-09-01', endReason: 'debtor' }).where(eq(financeSepaMandates.id, mandate.id)).run();
    expect(fail(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'directDebit', mandateId: mandate.id }))).toMatchObject({ code: 'mandateNotUsable', params: { reference: 'MND-000001' } });
  });

  it('needs finance.directDebit, dms.create for the draft, and valid days; audited', async () => {
    const f = await setup();
    expect(fail(await savePledge(f.deps, ctxWith(['finance.read'], f.userId), { ...f.base, paymentMethod: 'transfer' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await savePledge(f.deps, ctxWith(FINANCE_PERMISSIONS, f.userId), { ...f.base, paymentMethod: 'directDebit', iban: IBAN, debtorName: 'Erika Beispiel' }))).toMatchObject({ type: 'forbidden' });
    expect(f.deps.db.select().from(financeSepaMandates).all()).toEqual([]);
    expect(fail(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'transfer', lastDueOn: '2026-10-01' }))).toMatchObject({ type: 'validation' });
    expect(fail(await savePledge(f.deps, f.ctx, { ...f.base, amountCents: 0, paymentMethod: 'transfer' }))).toMatchObject({ type: 'validation' });
    const saved = unwrap(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'standingOrder', note: 'Erika zahlt per Dauerauftrag' }));
    unwrap(await savePledge(f.deps, f.ctx, { ...f.base, id: saved.pledge.id, amountCents: 1500, paymentMethod: 'standingOrder' }));
    expect(f.deps.db.select().from(financePledges).get()).toMatchObject({ amountCents: 1500, note: null });
    const audit = f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, 'finance.pledge.%')).all();
    expect(audit.map((e) => [e.action, e.params])).toEqual([['finance.pledge.save', null], ['finance.pledge.save', null]]);
  });
});

describe('pausePledge, endPledge, getPledge, listPledges', () => {
  it('a resting pledge skips its rates and reads as paused; an ended one reads as ended', async () => {
    const f = await setup();
    const { pledge } = unwrap(await savePledge(f.deps, f.ctx, { ...f.base, firstDueOn: '2026-01-15', paymentMethod: 'transfer' }));
    unwrap(await pausePledge(f.deps, f.ctx, { pledgeId: pledge.id, from: '2026-09-01', until: '2026-11-30' }));
    const rested = unwrap(await getPledge(f.deps, f.ctx, { id: pledge.id }));
    expect(rested.state).toBe('paused');
    expect(rested.rates.filter((r) => r.state === 'skipped').map((r) => r.dueOn)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
    expect(fail(await pausePledge(f.deps, f.ctx, { pledgeId: pledge.id, from: '2026-12-01', until: '2026-11-30' }))).toMatchObject({ type: 'validation' });
    unwrap(await endPledge(f.deps, f.ctx, { pledgeId: pledge.id, endedOn: '2026-09-05' }));
    expect(unwrap(await getPledge(f.deps, f.ctx, { id: pledge.id })).state).toBe('ended');
    expect(fail(await endPledge(f.deps, f.ctx, { pledgeId: pledge.id, endedOn: '2026-09-05' }))).toMatchObject({ code: 'pledgeEnded' });
    const audit = f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, 'finance.pledge.%')).all().map((e) => [e.action, e.params]);
    expect(audit).toEqual([
      ['finance.pledge.save', null],
      ['finance.pledge.pause', JSON.stringify({ fromOn: '2026-09-01', untilOn: '2026-11-30' })],
      ['finance.pledge.end', JSON.stringify({ endedOn: '2026-09-05' })],
    ]);
  });

  it('lists pledges by state and search; reading needs finance.read', async () => {
    const f = await setup();
    const a = unwrap(await savePledge(f.deps, f.ctx, { ...f.base, paymentMethod: 'transfer' }));
    unwrap(await savePledge(f.deps, f.ctx, { ...f.base, interval: 'yearly', paymentMethod: 'transfer' }));
    unwrap(await pausePledge(f.deps, f.ctx, { pledgeId: a.pledge.id, from: '2026-09-01', until: '2026-12-31' }));
    expect(unwrap(await listPledges(f.deps, f.ctx, { limit: 50, offset: 0 })).total).toBe(2);
    expect(unwrap(await listPledges(f.deps, f.ctx, { state: 'paused', limit: 50, offset: 0 })).items.map((p) => p.id)).toEqual([a.pledge.id]);
    expect(unwrap(await listPledges(f.deps, f.ctx, { search: 'beisp', limit: 50, offset: 0 })).total).toBe(2);
    expect(unwrap(await listPledges(f.deps, f.ctx, { search: 'nobody', limit: 50, offset: 0 })).total).toBe(0);
    expect(unwrap(await listPledges(f.deps, f.ctx, { general: true, limit: 50, offset: 0 })).total).toBe(2);
    expect(unwrap(await listPledges(f.deps, f.ctx, { purposeId: 'elsewhere', limit: 50, offset: 0 })).total).toBe(0);
    expect(fail(await getPledge(f.deps, ctxWith(['finance.directDebit'], f.userId), { id: a.pledge.id }))).toMatchObject({ type: 'forbidden' });
  });
});
