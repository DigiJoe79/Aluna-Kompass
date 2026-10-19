import { unwrap, writeSettingInternal } from '@kompass/core';
import { fakeMailTransport, systemContext } from '@kompass/core/testing';
import { dmsMailOutbox, documents, processOutbox, switchToPost } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueMemberLetterInternal } from '../src/letters/issue';
import { admitMember } from '../src/memberships';
import { markRunPostDispatched, moveRunLetters, recordRunLetterInternal, runDispatchState, runPrintPdf, sendRunMails } from '../src/run-dispatch';
import { addressedPerson, asMcp, auditOf, MEMBERS_PERMISSIONS, setupFees } from './helpers';

const NOW = '2027-02-10T08:00:00.000Z';
const RUN = 'membersFeeRun:01RUN';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

/** Zwei Briefe eines Laufs: einer an eine Adresse mit E-Mail, einer nur mit Anschrift. */
async function setup(opts: { mailOff?: boolean } = {}) {
  const mail = fakeMailTransport(opts.mailOff ? { state: { kind: 'off' } } : {});
  const env = await setupFees({ now: NOW, validFrom: '2027-01-01', mail, permissions: [...MEMBERS_PERMISSIONS, 'dms.view', 'dms.create', 'dms.send'] });
  const { deps, ctx, types } = env;
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  const issue = async (contactId: string) => {
    const member = unwrap(await admitMember(deps, ctx, { contactId, typeId: types.regular, admittedOn: '2026-01-01' }));
    return unwrap(
      await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } }, { afterIssue: (tx, doc, recipient) => recordRunLetterInternal(tx, deps, { runRef: RUN, membershipId: member.id, documentId: doc.id, contactId: recipient }) }),
    );
  };
  const byMail = await issue(await addressedPerson(deps, { email: 'erika@example.org' }));
  const byPost = await issue(await addressedPerson(deps, { lastName: 'Post' }));
  return { ...env, mail, byMail, byPost };
}

describe('runDispatchState', () => {
  it('splits the letters of a run into mail and post; done only when every line is sent or dispatched', async () => {
    const { deps, ctx, byMail, byPost } = await setup();
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.mail).toEqual([expect.objectContaining({ documentId: byMail.documentId, memberNumber: '0001', name: 'Erika Beispiel', address: 'erika@example.org', state: 'notQueued', outboxId: null, levelName: null })]);
    expect(state.post).toEqual([expect.objectContaining({ documentId: byPost.documentId, memberNumber: '0002', reason: 'noEmail', dispatched: false })]);
    expect(state.mailState.kind).toBeDefined();
    expect(state.done).toBe(false);
  });

  it('needs members.read and a valid run reference', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await runDispatchState(deps, { ...ctx, permissions: new Set(['dms.view']) }, { runRef: RUN }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await runDispatchState(deps, ctx, { runRef: 'financeRun:1' }))).toMatchObject({ type: 'validation' });
  });
});

describe('sendRunMails', () => {
  it('queues the mail group with the run reference; sent, the line counts as done', async () => {
    const { deps, ctx, mail, byMail } = await setup();
    const sent = unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    expect(sent.queued).toBe(1);
    expect(deps.db.select().from(dmsMailOutbox).all().map((r) => [r.documentId, r.runRef])).toEqual([[byMail.documentId, RUN]]);
    expect(unwrap(await runDispatchState(deps, ctx, { runRef: RUN })).mail[0]!.state).toBe('queued');
    await processOutbox(deps);
    expect(mail.sent).toHaveLength(1);
    expect(unwrap(await runDispatchState(deps, ctx, { runRef: RUN })).mail[0]!.state).toBe('sent');
    expect(auditOf(deps, 'members.run.mail').at(-1)!.params).toEqual({ kind: 'feeRun', count: 1 });
    // Ein zweites Mal reiht nichts ein.
    expect(unwrap(await sendRunMails(deps, ctx, { runRef: RUN })).queued).toBe(0);
  });

  it('is human only and needs dms.send', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await sendRunMails(deps, asMcp(ctx), { runRef: RUN }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(fail(await sendRunMails(deps, { ...ctx, permissions: new Set(MEMBERS_PERMISSIONS) }, { runRef: RUN }))).toMatchObject({ type: 'forbidden' });
  });

  it('„Per Post schicken“ moves a waiting line into the post group', async () => {
    const { deps, ctx, byMail } = await setup();
    unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    const entry = deps.db.select().from(dmsMailOutbox).get()!;
    unwrap(await switchToPost(deps, ctx, { outboxIds: [entry.id] }));
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.mail).toEqual([]);
    expect(state.post.find((p) => p.documentId === byMail.documentId)).toMatchObject({ reason: 'manual', dispatched: false });
  });
});

describe('runPrintPdf and markRunPostDispatched', () => {
  it('joins the post group into one PDF, then marks it as sent by post', async () => {
    const { deps, ctx, byMail, byPost } = await setup();
    const pdf = unwrap(await runPrintPdf(deps, ctx, { runRef: RUN }));
    expect(pdf.fileName).toBe('Briefe-Beitragslauf.pdf');
    expect(pdf.bytes.byteLength).toBeGreaterThan(0);
    const marked = unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10' }));
    expect(marked.count).toBe(1);
    expect(deps.db.select().from(documents).where(eq(documents.id, byPost.documentId)).get()).toMatchObject({ sentAt: '2027-02-10', sentVia: 'post' });
    expect(deps.db.select().from(documents).where(eq(documents.id, byMail.documentId)).get()!.sentAt).toBeNull();
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.post[0]!.dispatched).toBe(true);
    expect(state.done).toBe(false);
    expect(auditOf(deps, 'members.run.markPost').at(-1)!.params).toEqual({ kind: 'feeRun', count: 1, sentOn: '2027-02-10' });
  });

  it('marks only the named letters of the post group (one line)', async () => {
    const { deps, ctx, byMail, byPost } = await setup();
    expect(unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byPost.documentId] }))).toEqual({ count: 1 });
    expect(deps.db.select().from(documents).where(eq(documents.id, byMail.documentId)).get()!.sentAt).toBeNull();
  });

  it('refuses a date in the future and an empty post group', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-03-01' }))).toMatchObject({ type: 'validation' });
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10' }));
    // R13 (M42): Ohne Auswahl und mit leerer Post-Gruppe sagt der Satz das — der Brief der Mail-Gruppe hat keinen Vermerk.
    expect(fail(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10' }))).toMatchObject({ type: 'conflict', code: 'runPostGroupEmpty' });
    expect(fail(await runPrintPdf(deps, { ...ctx, permissions: new Set(['dms.view']) }, { runRef: RUN }))).toMatchObject({ type: 'forbidden' });
  });
});

describe('markRunPostDispatched — Mail-Gruppe per Post (M42)', () => {
  it('a letter already marked as sent by post is not mailed again (R9)', async () => {
    const { deps, ctx, mail, byMail } = await setup();
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byMail.documentId] }));
    expect(unwrap(await sendRunMails(deps, ctx, { runRef: RUN }))).toMatchObject({ queued: 0 });
    await processOutbox(deps);
    expect(mail.sent).toHaveLength(0);
  });

  it('a letter of the mail group, not queued, can be printed and marked as sent by post', async () => {
    const { deps, ctx, byMail } = await setup();
    expect(unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byMail.documentId] }))).toEqual({ count: 1 });
    expect(deps.db.select().from(documents).where(eq(documents.id, byMail.documentId)).get()).toMatchObject({ sentVia: 'post' });
    expect(unwrap(await runDispatchState(deps, ctx, { runRef: RUN })).mail).toEqual([expect.objectContaining({ documentId: byMail.documentId, sentAt: expect.any(String) })]);
  });

  it('a queued mail is refused with its true reason; nothing left names the letters, not the post group', async () => {
    const { deps, ctx, byMail, byPost } = await setup();
    unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    expect(fail(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byMail.documentId] }))).toMatchObject({ type: 'conflict', code: 'runLetterQueued' });
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byPost.documentId] }));
    expect(fail(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byPost.documentId] }))).toMatchObject({ type: 'conflict', code: 'runNothingToDispatch' });
  });
});

/**
 * Plan U4 Task 2 (Nachtrag MCP-Test § 2, M42): Eine Zeile der Mail-Gruppe wandert je Zeile in die Post-Gruppe
 * („Per Post schicken“, Grund `manual`) und zurück („Zurück zu E-Mail“, solange nicht vermerkt).
 */
describe('moveRunLetters', () => {
  const setStatus = (deps: Awaited<ReturnType<typeof setup>>['deps'], status: 'sending' | 'sent' | 'failed') => deps.db.update(dmsMailOutbox).set({ status }).run();

  it('moves a waiting line (not yet queued) into the post group with reason manual; the counts follow', async () => {
    const { deps, ctx, byMail } = await setup();
    expect(unwrap(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }))).toEqual({ count: 1 });
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.mail).toEqual([]);
    expect(state.post).toHaveLength(2);
    expect(state.post.find((p) => p.documentId === byMail.documentId)).toMatchObject({ reason: 'manual', dispatched: false });
    expect(auditOf(deps, 'members.run.toPost').at(-1)!.params).toEqual({ kind: 'feeRun', count: 1 });
    // Ausgestellt wird danach nichts per Mail.
    expect(unwrap(await sendRunMails(deps, ctx, { runRef: RUN })).queued).toBe(0);
  });

  it('moves a queued („wartet“) and a failed line; the mail is withdrawn from the outbox', async () => {
    const { deps, ctx, byMail } = await setup();
    unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    unwrap(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }));
    expect(deps.db.select().from(dmsMailOutbox).get()!.status).toBe('withdrawn');
    const failed = await setup();
    unwrap(await sendRunMails(failed.deps, failed.ctx, { runRef: RUN }));
    setStatus(failed.deps, 'failed');
    expect(unwrap(await moveRunLetters(failed.deps, failed.ctx, { runRef: RUN, documentIds: [failed.byMail.documentId], to: 'post' }))).toEqual({ count: 1 });
  });

  it('refuses a line being sent or already sent', async () => {
    const { deps, ctx, byMail } = await setup();
    unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    setStatus(deps, 'sending');
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }))).toMatchObject({ type: 'conflict', code: 'mailNotPending' });
    setStatus(deps, 'sent');
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }))).toMatchObject({ type: 'conflict', code: 'mailNotPending' });
    expect(auditOf(deps, 'members.run.toPost')).toHaveLength(0);
  });

  it('„Zurück zu E-Mail“ brings a moved line back, also one that was queued before; then it can be sent', async () => {
    const { deps, ctx, byMail } = await setup();
    unwrap(await sendRunMails(deps, ctx, { runRef: RUN }));
    unwrap(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }));
    expect(unwrap(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'email' }))).toEqual({ count: 1 });
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.mail).toEqual([expect.objectContaining({ documentId: byMail.documentId, state: 'notQueued' })]);
    expect(state.post).toHaveLength(1);
    expect(auditOf(deps, 'members.run.toEmail').at(-1)!.params).toEqual({ kind: 'feeRun', count: 1 });
    expect(unwrap(await sendRunMails(deps, ctx, { runRef: RUN })).queued).toBe(1);
  });

  it('back only without a dispatch note, and only for lines moved by hand', async () => {
    const { deps, ctx, byMail, byPost } = await setup();
    unwrap(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }));
    unwrap(await markRunPostDispatched(deps, ctx, { runRef: RUN, sentAt: '2027-02-10', documentIds: [byMail.documentId] }));
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'email' }))).toMatchObject({ type: 'conflict', code: 'mailAlreadyDispatched' });
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byPost.documentId], to: 'email' }))).toMatchObject({ type: 'conflict', code: 'mailNotMovedToPost' });
    // Ein Brief mit Vermerk wandert auch nicht mehr in die Post-Gruppe.
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byPost.documentId], to: 'post' }))).toMatchObject({ type: 'conflict' });
  });

  it('with e-mail off there is no mail group: every line goes by post with reason mailOff', async () => {
    const { deps, ctx } = await setup({ mailOff: true });
    const state = unwrap(await runDispatchState(deps, ctx, { runRef: RUN }));
    expect(state.mail).toEqual([]);
    expect(state.post.map((p) => p.reason)).toEqual(['mailOff', 'mailOff']);
  });

  it('needs members.fees, a letter of the run and a valid direction', async () => {
    const { deps, ctx, byMail } = await setup();
    expect(fail(await moveRunLetters(deps, { ...ctx, permissions: new Set(['members.read', 'dms.view']) }, { runRef: RUN, documentIds: [byMail.documentId], to: 'post' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await moveRunLetters(deps, ctx, { runRef: RUN, documentIds: [byMail.documentId], to: 'fax' }))).toMatchObject({ type: 'validation' });
    expect(fail(await moveRunLetters(deps, ctx, { runRef: 'membersFeeRun:01OTHER', documentIds: [byMail.documentId], to: 'post' }))).toMatchObject({ type: 'notFound' });
  });
});
