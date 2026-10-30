import { unwrap, writeSettingInternal } from '@kompass/core';
import { fakeMailTransport, systemContext } from '@kompass/core/testing';
import { dmsMailOutbox, processOutbox } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { proposeAgenda } from '../src/agenda-proposal';
import { invitationDispatchState, markInvitationPostDispatched, moveInvitationLetters, printInvitationPdf, sendInvitationMails } from '../src/invitation/dispatch';
import { continueInvitationRun, RUN_REF_PREFIX, startInvitationRun } from '../src/invitation/runs';
import { createMeeting } from '../src/meetings';
import { governanceOrgans } from '../src/schema';
import { addressedPerson, asMcp, auditOf, GOVERNANCE_PERMISSIONS, member, setupGovernance } from './helpers';

const PERMISSIONS = [...GOVERNANCE_PERMISSIONS, 'dms.view', 'dms.send'];

/** Drei Briefe eines fertigen Laufs: zwei per Mail, einer per Post. */
async function setup() {
  const mail = fakeMailTransport();
  const env = setupGovernance(PERMISSIONS, { now: '2026-08-10T08:00:00.000Z', mail });
  const { deps, ctx } = env;
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  for (const [lastName, email] of [['Eins', 'eins@example.org'], ['Zwei', 'zwei@example.org'], ['Post', undefined]] as const) await member(deps, { contactId: await addressedPerson(deps, { lastName, ...(email ? { email } : {}) }) });
  const organId = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'assembly')!.id;
  const meeting = unwrap(await createMeeting(deps, ctx, { organId, kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' }));
  unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
  const run = unwrap(await startInvitationRun(deps, ctx, { meetingId: meeting.id, kind: 'invitation' }));
  unwrap(await continueInvitationRun(deps, ctx, { runId: run.id }));
  return { ...env, mail, run, meeting };
}

describe('invitation dispatch', () => {
  it('splits the letters into mail and post; mails are queued with the run reference, human only', async () => {
    const { deps, ctx, run } = await setup();
    const state = unwrap(await invitationDispatchState(deps, ctx, { runId: run.id }));
    expect(state.mail).toHaveLength(2);
    expect(state.post).toEqual([expect.objectContaining({ reason: 'noEmail', dispatched: false, memberNumber: '0003' })]);
    expect(state.done).toBe(false);
    expect(state.mail.map((m) => m.name).sort()).toEqual(['Erika Eins', 'Erika Zwei']);
    expect(state.post.map((p) => p.name)).toEqual(['Erika Post']);
    expect(state.mail.every((m) => m.outboxId === null)).toBe(true);
    expect(await sendInvitationMails(deps, asMcp(ctx), { runId: run.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect(await sendInvitationMails(deps, { ...ctx, permissions: new Set(GOVERNANCE_PERMISSIONS) }, { runId: run.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(unwrap(await sendInvitationMails(deps, ctx, { runId: run.id }))).toEqual({ queued: 2, post: 1 });
    expect(deps.db.select().from(dmsMailOutbox).all().map((r) => r.runRef)).toEqual([RUN_REF_PREFIX + run.id, RUN_REF_PREFIX + run.id]);
    expect(unwrap(await invitationDispatchState(deps, ctx, { runId: run.id })).mail.every((m) => m.outboxId !== null)).toBe(true);
    expect(auditOf(deps, 'governance.invitation.mail')[0]!.params).toEqual({ count: 2 });
  });

  it('marks the post group, moves a mail letter to post and back, and is done when everything is out', async () => {
    const { deps, ctx, run } = await setup();
    const state = unwrap(await invitationDispatchState(deps, ctx, { runId: run.id }));
    const [first, second] = state.mail.map((m) => m.documentId);
    unwrap(await moveInvitationLetters(deps, ctx, { runId: run.id, documentIds: [first!], to: 'post' }));
    expect(unwrap(await invitationDispatchState(deps, ctx, { runId: run.id })).post).toHaveLength(2);
    unwrap(await moveInvitationLetters(deps, ctx, { runId: run.id, documentIds: [first!], to: 'email' }));
    unwrap(await moveInvitationLetters(deps, ctx, { runId: run.id, documentIds: [second!], to: 'post' }));
    const printed = unwrap(await printInvitationPdf(deps, ctx, { runId: run.id }));
    expect(printed.count).toBe(2);
    expect(unwrap(await markInvitationPostDispatched(deps, ctx, { runId: run.id, sentAt: '2026-08-10' }))).toEqual({ count: 2 });
    expect(auditOf(deps, 'governance.invitation.markPost')[0]!.params).toEqual({ count: 2, sentOn: '2026-08-10' });
    unwrap(await sendInvitationMails(deps, ctx, { runId: run.id }));
    await processOutbox(deps);
    expect(unwrap(await invitationDispatchState(deps, ctx, { runId: run.id })).done).toBe(true);
    expect(auditOf(deps, 'governance.invitation.toPost')).toHaveLength(2);
    expect(auditOf(deps, 'governance.invitation.toEmail')).toHaveLength(1);
  });

  it('refuses a dispatch day in the future', async () => {
    const { deps, ctx, run } = await setup();
    expect(await markInvitationPostDispatched(deps, ctx, { runId: run.id, sentAt: '2026-08-11' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
