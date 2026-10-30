import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { proposedExclusionsInternal } from '../src/exclusions';
import { saveResolution } from '../src/resolutions';
import { holders, member, officeOf, organOf, RECORDING, session, setupGovernance } from './helpers';

describe('proposedExclusionsInternal', () => {
  it('remuneration of the treasurer office excludes its holder, also as default of saveResolution', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [treasurer] = await holders(deps, ctx, ['treasurer']);
    const details = { statuteReference: '§ 8', decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeOf(deps, 'treasurer')], mode: 'flat', amountCents: 1000, validFrom: '2027-01-01' };
    expect(proposedExclusionsInternal(deps.db, { kind: 'remuneration', details, decidedOn: '2026-09-05', organId: organOf(deps, 'assembly') })).toEqual([{ contactId: treasurer, reason: 'remuneration' }]);
    await member(deps, { contactId: treasurer });
    const { items } = await session(deps, ctx, { items: ['remuneration'], voters: 3 });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, details }));
    expect(saved.excluded).toEqual([{ contactId: treasurer, reason: 'remuneration', note: null }]);
    expect(saved.votes).toMatchObject({ yes: 3 });
  });

  it('an election excludes nobody; an exclusion excludes the member', async () => {
    const { deps } = setupGovernance(RECORDING);
    const { membershipId, contactId } = await member(deps);
    const mv = organOf(deps, 'assembly');
    expect(proposedExclusionsInternal(deps.db, { kind: 'election', details: { officeId: officeOf(deps, 'chair'), rounds: [], elected: [] }, decidedOn: '2026-09-05', organId: mv })).toEqual([]);
    const exclusion = { membershipId, statuteGround: null, reasonsSentOn: null, hearingOn: null, reasonsDocumentId: null, noticeReceivedOn: null };
    expect(proposedExclusionsInternal(deps.db, { kind: 'exclusion', details: exclusion, decidedOn: '2026-09-05', organId: mv })).toEqual([{ contactId, reason: 'exclusion' }]);
    expect(proposedExclusionsInternal(deps.db, { kind: 'simple', details: null, decidedOn: '2026-09-05', organId: mv })).toEqual([]);
  });
});
