import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveFindings } from '../src/findings';
import { recordInvitationNote } from '../src/invitation/board';
import { createMeeting } from '../src/meetings';
import { sealPreviewInternal } from '../src/seal/preview';
import { startMeeting } from '../src/session';
import { auditOf, holders, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

describe('saveFindings', () => {
  it('suggests a proper invitation from the notice kept, and stores the findings', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { noticeDays: 7 } });
    const [chair] = await holders(deps, ctx, ['chair']);
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'board'), kind: 'board', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await recordInvitationNote(deps, ctx, { meetingId: meeting.id, invitedOn: '2026-08-20', note: 'Messenger' }));
    unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
    const saved = unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { invitationProper: true, chairContactId: chair!, chairBy: 'statute' } }));
    expect(saved).toMatchObject({ invitationProper: true, chairContactId: chair, chairBy: 'statute', quorate: null, suggested: { invitationProper: true }, warnings: [] });
    expect(auditOf(deps, 'governance.findings.save')[0]!.params).toEqual({ fields: 'invitationProper, chairContactId, chairBy' });
  });

  it('G-11: a quorum found against the count without a note is kept with reasonMissing, which blocks sealing; with a note only warned', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { quorum: { kind: 'absolute', count: 5 } } });
    const { meeting } = await session(deps, ctx, { items: [], voters: 3 });
    const saved = unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { quorate: true } }));
    expect(saved).toMatchObject({ quorate: true, warnings: ['findingAgainstCount', 'reasonMissing'] });
    expect(sealPreviewInternal(deps.db, deps, { meetingId: meeting.id })!.blockers).toContain('reasonMissing');
    const noted = unwrap(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { quorate: true, quorumNote: 'Zwei Mitglieder per Video zugeschaltet.' } }));
    expect(noted).toMatchObject({ quorate: true, suggested: { quorum: { met: false, required: 5, present: 3 } }, warnings: ['findingAgainstCount'] });
    expect(sealPreviewInternal(deps.db, deps, { meetingId: meeting.id })!.blockers).not.toContain('reasonMissing');
    expect(await saveFindings(deps, ctx, { meetingId: meeting.id, findings: { chairBy: 'boss' } })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
