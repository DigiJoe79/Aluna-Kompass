import { unwrap, writeSettingInternal } from '@kompass/core';
import { fakeMailTransport, systemContext } from '@kompass/core/testing';
import { documentLinks, dmsMailOutbox } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueBoardInvitation, recordInvitationNote, sendBoardInvitation } from '../src/invitation/board';
import { createMeeting, deleteMeeting } from '../src/meetings';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { startTerm } from '../src/terms';
import { addressedPerson, asMcp, auditOf, GOVERNANCE_PERMISSIONS, setupGovernance, type GovernanceDeps } from './helpers';

const PERMISSIONS = [...GOVERNANCE_PERMISSIONS, 'dms.view', 'dms.send'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' as const };

async function setup() {
  const mail = fakeMailTransport();
  const env = setupGovernance(PERMISSIONS, { now: '2026-08-10T08:00:00.000Z', mail });
  const { deps, ctx } = env;
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  const holders: string[] = [];
  for (const fn of ['chair', 'board', 'treasurer']) {
    const contactId = await addressedPerson(deps, { lastName: fn, email: `${fn}@example.org` });
    holders.push(contactId);
    unwrap(await startTerm(deps, ctx, { officeId: deps.db.select().from(governanceOffices).all().find((o) => o.function === fn)!.id, contactId, since: '2026-01-01', origin: 'backfilled' }));
  }
  const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...head }));
  return { ...env, mail, holders, meeting };
}

describe('board invitation', () => {
  it('issues one document to the three office holders, sends it by mail, the meeting is invited', async () => {
    const { deps, ctx, holders, meeting } = await setup();
    expect(await issueBoardInvitation(deps, asMcp(ctx), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    const invited = unwrap(await issueBoardInvitation(deps, ctx, { meetingId: meeting.id }));
    expect(invited).toMatchObject({ state: 'invited', invitedOn: '2026-08-10' });
    const recipients = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, invited.invitationDocumentId!)).all().filter((l) => l.role === 'recipient').map((l) => l.entityId);
    expect(recipients.sort()).toEqual([...holders].sort());
    expect(await sendBoardInvitation(deps, asMcp(ctx), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect(unwrap(await sendBoardInvitation(deps, ctx, { meetingId: meeting.id }))).toEqual({ queued: 3, post: 0 });
    expect(deps.db.select().from(dmsMailOutbox).all().map((r) => r.runRef)).toEqual(Array(3).fill(`governanceMeeting:${meeting.id}`));
    expect(auditOf(deps, 'governance.boardInvitation.issue')).toHaveLength(1);
    expect(await issueBoardInvitation(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invitationExists' } });
  });

  it('Review Focus 5: a note "per Messenger" invites without a document; the meeting is no longer deletable', async () => {
    const { deps, ctx, meeting } = await setup();
    const noted = unwrap(await recordInvitationNote(deps, asMcp(ctx), { meetingId: meeting.id, invitedOn: '2026-08-09', note: 'Messenger' }));
    expect(noted).toMatchObject({ state: 'invited', invitedOn: '2026-08-09', invitationNote: 'Messenger', invitationDocumentId: null });
    expect(auditOf(deps, 'governance.invitation.note')[0]!.params).toEqual({ invitedOn: '2026-08-09' });
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'meetingNotDeletable' } });
  });

  it('is only for the board and other organs', async () => {
    const { deps, ctx } = await setup();
    const mv = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'assembly'), kind: 'ordinary', ...head }));
    expect(await issueBoardInvitation(deps, ctx, { meetingId: mv.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'runNotForOrgan' } });
    expect(await recordInvitationNote(deps, ctx, { meetingId: mv.id, invitedOn: '2026-08-09', note: 'Messenger' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'runNotForOrgan' } });
    const reader = setupGovernance(['governance.read']);
    expect(await recordInvitationNote(reader.deps, reader.ctx, { meetingId: mv.id, invitedOn: '2026-08-09', note: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
