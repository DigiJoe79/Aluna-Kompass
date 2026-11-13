import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { continueFeeRun, startFeeRun } from '../src/fee-run';
import { membersPayerContacts } from '../src/fees';
import { admitMember, recordApplication } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { person, setupFees } from './helpers';

/** Spec Zahlung zuordnen § 3.2b: Die Erziehungsberechtigte zahlt für das Mitglied — nur bis zu dessen 18. Geburtstag. */
async function minorWithFee(birthDate: string | null) {
  const env = await setupFees({ now: '2027-02-10T08:00:00.000Z' });
  const { deps, ctx, types } = env;
  const guardian = await person(deps, 'Mutter', 'Sabine');
  const applied = unwrap(await recordApplication(deps, ctx, { contactId: await person(deps, 'Kind', 'Mia'), typeId: types.regular, appliedOn: '2026-12-01', birthDate, guardianContactId: guardian }));
  unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2026-12-15', joinedOn: '2026-12-15' }));
  const run = unwrap(await startFeeRun(deps, ctx, { year: 2027 }));
  unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
  const charge = deps.db.select().from(memberFeeCharges).all().find((c) => c.membershipId === applied.id)!;
  return { deps, guardian, charge };
}

describe('membersPayerContacts', () => {
  it('names the guardian for a payment before the 18th birthday, none from that day on', async () => {
    const { deps, guardian, charge } = await minorWithFee('2009-03-15');
    expect(membersPayerContacts(deps, deps.db, { originId: charge.id, paymentDate: '2027-03-14' })).toEqual([guardian]);
    expect(membersPayerContacts(deps, deps.db, { originId: charge.id, paymentDate: '2027-03-15' })).toEqual([]);
  });

  it('without a birth date there is no time limit, so no guardian either', async () => {
    const { deps, charge } = await minorWithFee(null);
    expect(membersPayerContacts(deps, deps.db, { originId: charge.id, paymentDate: '2027-01-20' })).toEqual([]);
  });

  it('an unknown charge has no payers', async () => {
    const { deps } = await minorWithFee('2015-05-01');
    expect(membersPayerContacts(deps, deps.db, { originId: 'nope', paymentDate: '2027-01-20' })).toEqual([]);
  });
});
