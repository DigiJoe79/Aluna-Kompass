import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { financeSepaMandates } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { createMember } from '../src/create-member';
import { memberMemberships } from '../src/schema';
import { asMcp, auditOf, person, setupFees } from './helpers';

const NOW = '2026-09-01T10:00:00.000Z';

describe('createMember', () => {
  it('applies, agrees direct debit with a prepared mandate and admits in one go', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    const contactId = await person(deps, 'Kruse', 'Uwe');
    const res = unwrap(await createMember(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2026-08-20', admittedOn: '2026-09-01', agreement: { paymentMethod: 'directDebit', iban: 'DE23999999990000202051', debtorName: 'Uwe Kruse' }, letter: false }));
    expect(res).toMatchObject({ status: 'active', memberNumber: '0001', letter: null });
    expect(deps.db.select().from(financeSepaMandates).all()).toHaveLength(1);
    expect(auditOf(deps, 'members.membership.apply')).toHaveLength(1);
    expect(auditOf(deps, 'members.membership.admit')).toHaveLength(1);
  });

  it('creates nothing when the agreement is refused — no membership, no audit entry for the application', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    const contactId = await person(deps, 'Falkner', 'Greta');
    const res = await createMember(deps, ctx, { contactId, typeId: types.supporting, appliedOn: '2026-08-20', agreement: { paymentMethod: 'transfer', amountCents: 500 } });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'feeBelowMinimum' } });
    expect(deps.db.select().from(memberMemberships).all()).toHaveLength(0);
    expect(auditOf(deps, 'members.membership.apply')).toHaveLength(0);
    expect(auditOf(deps, 'members.feeAgreement.set')).toHaveLength(0);
  });

  it('needs members.manage, members.fees for an agreement, a human for the admission', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    const contactId = await person(deps);
    expect(await createMember(deps, ctxWith(['members.read']), { contactId, typeId: types.regular, appliedOn: '2026-08-20' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await createMember(deps, ctxWith(['members.manage']), { contactId, typeId: types.regular, appliedOn: '2026-08-20', agreement: { paymentMethod: 'transfer', amountCents: 2000 } })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'members.fees' } });
    expect(await createMember(deps, asMcp(ctx), { contactId, typeId: types.regular, appliedOn: '2026-08-20', admittedOn: '2026-09-01' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(await createMember(deps, ctx, { contactId, typeId: types.regular, appliedOn: '20.08.2026' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
