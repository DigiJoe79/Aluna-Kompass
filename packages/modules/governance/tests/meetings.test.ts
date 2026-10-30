import { unwrap } from '@kompass/core';
import { linkDocumentInternal } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { getMeeting } from '../src/meeting-detail';
import { cancelMeeting, createMeeting, deleteMeeting, listMeetings, meetingStateOf, updateMeeting } from '../src/meetings';
import { governanceMeetings, governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { auditOf, receivedDocument, setupGovernance, type GovernanceDeps } from './helpers';

const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const base = { heldOn: '2026-11-20', startsAt: '19:00', form: 'inPerson' as const, place: 'Vereinsheim' };

describe('createMeeting', () => {
  it('creates a planned meeting and audits kind and day, never names', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'assembly'), kind: 'ordinary', ...base }));
    expect(meeting).toMatchObject({ kind: 'ordinary', heldOn: '2026-11-20', state: 'planned', warnings: [] });
    const [entry] = auditOf(deps, 'governance.meeting.create');
    expect(entry!.params).toEqual({ kind: 'ordinary', heldOn: '2026-11-20' });
    expect(JSON.stringify(entry)).not.toContain('Vereinsheim');
  });

  it('refuses a kind that does not fit the organ, a second founding and a repeat without its meeting', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    expect(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'ordinary', ...base })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await createMeeting(deps, ctx, { organId: mv, kind: 'board', ...base })).toMatchObject({ ok: false, error: { type: 'validation' } });
    unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'founding', ...base }));
    expect(await createMeeting(deps, ctx, { organId: mv, kind: 'founding', ...base })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'foundingExists' } });
    expect(await createMeeting(deps, ctx, { organId: mv, kind: 'repeat', ...base })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const board = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...base }));
    expect(await createMeeting(deps, ctx, { organId: mv, kind: 'repeat', repeatOfId: board.id, ...base })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('warns about a hybrid meeting without remote note, a forbidden form and a repeat without rule — and stores it', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    const hybrid = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...base, form: 'hybrid', access: 'https://example.org/raum' }));
    expect(hybrid.warnings).toEqual(['remoteNoteMissing']);
    const virtual = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'extraordinary', ...base, form: 'virtual', remoteNote: 'Abstimmung im Chat' }));
    expect(virtual.warnings).toEqual(['formNotAllowed']);
    const repeat = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'repeat', repeatOfId: hybrid.id, ...base }));
    expect(repeat.warnings).toEqual(['repeatWithoutRule']);
    expect(deps.db.select().from(governanceMeetings).all()).toHaveLength(3);
  });

  it('reads the allowed forms from the statute valid on the meeting day', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { formsAllowed: ['inPerson', 'virtual'], repeatMeeting: { withinDays: 28, noQuorum: true } } } } }));
    expect(unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...base, form: 'virtual', remoteNote: 'Chat' })).warnings).toEqual([]);
  });

  it('needs governance.manage', async () => {
    const { deps } = setupGovernance();
    const reader = setupGovernance(['governance.read']);
    expect(await createMeeting(reader.deps, reader.ctx, { organId: organ(deps, 'assembly'), kind: 'ordinary', ...base })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('meeting state, update, list', () => {
  it('computes the state from the day stamps', () => {
    const row = { cancelledOn: null, invitedOn: null } as Parameters<typeof meetingStateOf>[0];
    expect(meetingStateOf(row)).toBe('planned');
    expect(meetingStateOf({ ...row, invitedOn: '2026-10-01' })).toBe('invited');
    expect(meetingStateOf({ ...row, invitedOn: '2026-10-01', cancelledOn: '2026-10-05' })).toBe('cancelled');
  });

  it('updates the head, audits the changed fields and lists by organ, year and state', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...base }));
    const updated = unwrap(await updateMeeting(deps, ctx, { id: meeting.id, startsAt: '18:30', place: 'Rathaus' }));
    expect(updated).toMatchObject({ startsAt: '18:30', place: 'Rathaus' });
    expect(auditOf(deps, 'governance.meeting.update')[0]!.params).toEqual({ kind: 'ordinary', heldOn: '2026-11-20', fields: 'startsAt, place' });
    unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...base, heldOn: '2027-01-10' }));
    expect(unwrap(await listMeetings(deps, ctx, { organId: mv })).map((m) => m.id)).toEqual([meeting.id]);
    expect(unwrap(await listMeetings(deps, ctx, { year: 2027 }))).toHaveLength(1);
    expect(unwrap(await listMeetings(deps, ctx, { states: ['cancelled'] }))).toHaveLength(0);
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id }))).toMatchObject({ id: meeting.id, state: 'planned' });
  });
});

describe('deleteMeeting and cancelMeeting', () => {
  it('deletes a planned meeting without documents, audited', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...base }));
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: true });
    expect(deps.db.select().from(governanceMeetings).all()).toEqual([]);
    expect(auditOf(deps, 'governance.meeting.delete')[0]!.params).toEqual({ kind: 'board', heldOn: '2026-11-20' });
  });

  it('keeps a meeting with a linked document', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...base }));
    const documentId = await receivedDocument(deps);
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId, entityType: 'governanceMeeting', entityId: meeting.id }));
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotDeletable' } });
  });

  it('cancels with reason; no cancellation letters without a run; a cancelled meeting is not changed again', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'assembly'), kind: 'extraordinary', ...base }));
    const cancelled = unwrap(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-10-10', reason: 'Raum nicht verfügbar' }));
    expect(cancelled).toMatchObject({ state: 'cancelled', cancellationLettersDue: false, cancelReason: 'Raum nicht verfügbar' });
    expect(auditOf(deps, 'governance.meeting.cancel')[0]!.params).toEqual({ kind: 'extraordinary', heldOn: '2026-11-20', cancelledOn: '2026-10-10' });
    expect(await updateMeeting(deps, ctx, { id: meeting.id, place: 'x' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingCancelled' } });
    expect(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-10-11', reason: 'x' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingCancelled' } });
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotDeletable' } });
  });
});
