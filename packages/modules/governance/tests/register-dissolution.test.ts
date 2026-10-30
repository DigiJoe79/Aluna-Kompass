import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveDissolutionNotices, DISSOLUTION_HINTS } from '../src/register/dissolution';
import { createRegisterFiling, getRegisterFiling } from '../src/register/filings';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { auditOf, person, RECORDING, setupGovernance } from './helpers';
import { chairResigns, statuteMeeting } from './register-helpers';

const NOW = '2027-02-15T08:00:00.000Z';

async function dissolved() {
  const setup = setupGovernance(RECORDING, { now: NOW });
  const { deps, ctx } = setup;
  const stand = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id: stand, resolutions: [{ on: '2026-01-10', resolutionId: null }], rules: { organs: {}, assetBeneficiary: 'Tierschutzbund Beispielstadt e.V.' } }));
  const liquidator = await person(deps, 'Liquidatorin');
  const meeting = await statuteMeeting(deps, ctx, '2027-01-31', { kind: 'dissolution', liquidatorContactIds: [liquidator] });
  const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: meeting.occasionId }] }));
  return { ...setup, filingId: filing.id, liquidator };
}

describe('dissolution as register filing', () => {
  it('the notice to tax office and municipality is due within a month — at the month end on the last day (§ 137 AO, § 188 Abs. 3 BGB)', async () => {
    const { deps, ctx, filingId, liquidator } = await dissolved();
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filingId })).dissolution).toEqual({
      decidedOn: '2027-01-31',
      noticeDueOn: '2027-02-28',
      taxOfficeNotifiedOn: null,
      municipalityNotifiedOn: null,
      liquidatorContactIds: [liquidator],
      assetBeneficiary: 'Tierschutzbund Beispielstadt e.V.',
      announcedOn: null,
      blockingYearEndsOn: null,
      hints: DISSOLUTION_HINTS.map((h) => h.key),
    });
    const saved = unwrap(await saveDissolutionNotices(deps, ctx, { filingId, taxOfficeNotifiedOn: '2027-02-10', municipalityNotifiedOn: '2027-02-11', announcedOn: '2027-03-01' }));
    expect(saved.dissolution).toMatchObject({ taxOfficeNotifiedOn: '2027-02-10', municipalityNotifiedOn: '2027-02-11', announcedOn: '2027-03-01', blockingYearEndsOn: '2028-03-01' });
    expect(auditOf(deps, 'governance.register.dissolution').at(-1)!.params).toEqual({ fields: 'taxOfficeNotifiedOn, municipalityNotifiedOn, announcedOn' });
    // Ein Vermerk bleibt, wenn ein anderer gesetzt wird.
    expect(unwrap(await saveDissolutionNotices(deps, ctx, { filingId, announcedOn: null })).dissolution).toMatchObject({ taxOfficeNotifiedOn: '2027-02-10', announcedOn: null, blockingYearEndsOn: null });
  });

  it('no dissolution occasion → no facts and a conflict; refuses without manage', async () => {
    const { deps, ctx, userId, filingId } = await dissolved();
    expect(await saveDissolutionNotices(deps, ctxWith(['governance.read'], userId), { filingId, announcedOn: '2027-03-01' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    const other = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2027-02-01') }] }));
    expect(other.dissolution).toBeNull();
    expect(await saveDissolutionNotices(deps, ctx, { filingId: other.id, announcedOn: '2027-03-01' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'filingNotDissolution' } });
  });
});
