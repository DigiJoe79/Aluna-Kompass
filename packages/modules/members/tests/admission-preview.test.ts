import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { previewAdmission } from '../src/admission-preview';
import { admitMember, recordApplication } from '../src/memberships';
import { addressedPerson, setupFees } from './helpers';

const NOW = '2026-09-01T10:00:00.000Z';

describe('previewAdmission', () => {
  it('names the next number, the fees of the join year and whether a letter can go out', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Erste' }), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
    const application = unwrap(await recordApplication(deps, ctx, { contactId: await addressedPerson(deps, { address: false, lastName: 'Ohne' }), typeId: types.regular, appliedOn: '2026-08-20' }));
    const preview = unwrap(await previewAdmission(deps, ctx, { membershipId: application.id, admittedOn: '2026-09-01' }));
    expect(preview).toMatchObject({ nextNumber: '0002', year: 2026, createsFees: true, letterPossible: false, mandatePending: false });
    expect(preview.charges).toEqual([{ periodStart: '2026-01-01', periodEnd: '2026-12-31', amountCents: 1200, dueOn: '2026-09-01' }]);
  });

  it('says when no state of the fee schedule applies for the year, instead of creating nothing silently (R8)', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2027-07-20' });
    const application = unwrap(await recordApplication(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, appliedOn: '2026-08-20' }));
    const preview = unwrap(await previewAdmission(deps, ctx, { membershipId: application.id, admittedOn: '2026-09-01' }));
    expect(preview).toMatchObject({ year: 2026, charges: [], feeProblem: 'noSchedule' });
    const fine = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    const other = unwrap(await recordApplication(fine.deps, fine.ctx, { contactId: await addressedPerson(fine.deps), typeId: fine.types.regular, appliedOn: '2026-08-20' }));
    expect(unwrap(await previewAdmission(fine.deps, fine.ctx, { membershipId: other.id, admittedOn: '2026-09-01' })).feeProblem).toBeNull();
  });

  it('needs members.read and an open application', async () => {
    const { deps, ctx, types } = await setupFees({ now: NOW, validFrom: '2026-01-01' });
    const member = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps), typeId: types.regular, admittedOn: '2026-01-01', letter: false }));
    expect(await previewAdmission(deps, ctxWith(['members.fees']), { membershipId: member.id, admittedOn: '2026-09-01' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await previewAdmission(deps, ctx, { membershipId: member.id, admittedOn: '2026-09-01' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'membershipNotApplied' } });
    expect(await previewAdmission(deps, ctx, { membershipId: member.id, admittedOn: '01.09.2026' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
