import { isoNow, unwrap, type CallContext } from '@kompass/core';
import { systemContext, ctxWith } from '@kompass/core/testing';
import { endMembership } from '@kompass/module-members';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveAttendance } from '../src/attendance';
import { listMemberProposals } from '../src/seal/member-proposals';
import { governanceMeetings } from '../src/schema';
import { adopt, member, person, RECORDING, receivedDocument, session, setupGovernance, type GovernanceDeps } from './helpers';

/** Festgeschrieben, ohne Folgen zu wirken — die Vorschläge lesen nur den Stand (Task 6 wirkt sie). */
const markSealed = (deps: GovernanceDeps, meetingId: string) => deps.db.update(governanceMeetings).set({ sealedAt: isoNow(deps.clock), endedAt: '21:00' }).where(eq(governanceMeetings.id, meetingId)).run();
const membersCtx: CallContext = { ...systemContext(), permissions: new Set(['members.manage']) };

describe('listMemberProposals', () => {
  it('an exclusion is open until the membership ends with reason exclusion', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const excluded = await member(deps);
    const { meeting, items } = await session(deps, ctx, { items: ['exclusion'], voters: 3 });
    const details = { membershipId: excluded.membershipId, statuteGround: '§ 5', reasonsSentOn: '2026-08-01', hearingOn: '2026-08-20', reasonsDocumentId: null, noticeReceivedOn: null };
    const r = await adopt(deps, ctx, items[0]!.id, { details });
    markSealed(deps, meeting.id);
    expect(unwrap(await listMemberProposals(deps, ctxWith(['governance.read'], userId), {}))).toEqual([{ kind: 'endMembership', resolutionId: r.id, meetingId: meeting.id, contactId: excluded.contactId, membershipId: excluded.membershipId, on: '2026-09-05', done: false }]);
    unwrap(await endMembership(deps, membersCtx, { membershipId: excluded.membershipId, endsOn: '2026-09-30', reason: 'exclusion', documentId: await receivedDocument(deps, 'Ausschluss') }));
    expect(unwrap(await listMemberProposals(deps, ctx, {}))[0]!.done).toBe(true);
    expect(await listMemberProposals(deps, ctxWith([], userId), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('a founder with a membership since the founding day is done, one without is open', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { kind: 'founding', items: [], heldOn: '2025-01-01' });
    const withMembership = (await member(deps, { admittedOn: '2025-01-01' })).contactId;
    const without = await person(deps, 'Gründerin');
    for (const contactId of [withMembership, without]) unwrap(await saveAttendance(deps, ctx, { meetingId: meeting.id, contactId, role: 'founder' }));
    markSealed(deps, meeting.id);
    const proposals = unwrap(await listMemberProposals(deps, ctx, {}));
    expect(proposals.map((p) => [p.kind, p.contactId, p.done])).toEqual([
      ['createMembership', withMembership, true],
      ['createMembership', without, false],
    ]);
  });
});
