import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { auditEntry, fakeMailTransport, systemContext } from '@kompass/core/testing';
import { createContact, setContactChannels } from '@kompass/module-contacts';
import { dmsMailOutbox } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { confirmationRunDispatchState, continueConfirmationRun, dispatchRunConfirmations, markRunPostConfirmations, moveConfirmationRunLetters, readRunBundle, sendConfirmationRunEmails, startConfirmationRun } from '../src/donations/runs';
import { financeConfirmations } from '../src/schema';
import { donationFixture, err, type DonationFixture } from './donation-fixture';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';

/** Zuwendungsbestätigungen eines Serienlaufs per E-Mail (Plan E1, Task 6). Heute ist der 2026-03-20. */
async function fixture(machine: boolean) {
  const f = await donationFixture({ machine });
  f.deps.mail = fakeMailTransport();
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'dms.mail.fromAddress', 'post@example.org'));
  const ctx: CallContext = { ...f.ctx, permissions: new Set([...f.ctx.permissions, 'dms.send']) };
  const manage: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const anna = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Anna', lastName: 'Alpha', street: 'Probeweg 3', postalCode: '11111', city: 'Probestadt' }));
  unwrap(await setContactChannels(f.deps, manage, { id: anna.id, channels: [{ kind: 'email', value: 'anna@example.org', isPrimary: true }] }));
  await f.donate({ date: '2026-01-10', cents: 3000, contactId: anna.id });
  await f.donate({ date: '2026-01-12', cents: 1000 }); // Erika, ohne E-Mail-Adresse
  const run = unwrap(await startConfirmationRun(f.deps, ctx, { year: 2026 }));
  unwrap(await continueConfirmationRun(f.deps, ctx, { runId: run.id }));
  return { f, ctx, runId: run.id, annaId: anna.id };
}

const outbox = (f: DonationFixture) => f.deps.db.select().from(dmsMailOutbox).all();

describe('sendConfirmationRunEmails', () => {
  it('queues the items with an e-mail address when the machine procedure is complete, the rest go by post', async () => {
    const { f, ctx, runId, annaId } = await fixture(true);
    const result = unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId }));
    expect(result.queued).toBe(1);
    expect(result.post).toEqual([expect.objectContaining({ contactId: f.erika.id, channel: 'post', reason: 'noEmail' })]);
    const [row] = outbox(f);
    expect(row).toMatchObject({ contactId: annaId, toAddress: 'anna@example.org', status: 'queued', runRef: `financeConfirmationRun:${runId}` });
    expect(JSON.parse(auditEntry(f.deps, 'finance.confirmationRun.mail').params!)).toEqual({ year: 2026, count: 1 });

    // Ein zweites Mal reiht nichts ein.
    expect(unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId })).queued).toBe(0);

    // Der Versandvermerk des Laufs gilt danach nur noch den Post-Posten.
    unwrap(await dispatchRunConfirmations(f.deps, ctx, { runId, sentAt: '2026-03-20', sentVia: 'post' }));
    const confirmations = f.deps.db.select().from(financeConfirmations).all();
    expect(confirmations.find((c) => c.contactId === annaId)!.sentAt).toBeNull();
    expect(confirmations.find((c) => c.contactId === f.erika.id)!.sentAt).toBe('2026-03-20');
  });

  it('sends everything by post without the machine procedure, naming the reason', async () => {
    const { f, ctx, runId } = await fixture(false);
    const result = unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId }));
    expect(result.queued).toBe(0);
    expect(result.post).toHaveLength(2);
    expect(result.post.every((p) => p.channel === 'post' && p.reason === 'notMachineProcedure')).toBe(true);
    expect(outbox(f)).toEqual([]);
  });

  it('needs both permissions and a finished run', async () => {
    const { f, ctx, runId } = await fixture(true);
    expect(err(await sendConfirmationRunEmails(f.deps, f.ctx, { runId }))).toEqual({ type: 'forbidden', permission: 'dms.send' });
    expect(err(await sendConfirmationRunEmails(f.deps, ctx, {}))).toMatchObject({ type: 'validation' });
    f.deps.mail = fakeMailTransport({ state: { kind: 'blocked', reason: 'noRedirect' } });
    expect(err(await sendConfirmationRunEmails(f.deps, ctx, { runId }))).toMatchObject({ type: 'conflict', code: 'mailNotReady' });
    f.deps.mail = fakeMailTransport();
    // Ein Nachzügler-Lauf, gestartet, aber nicht fortgesetzt.
    await f.donate({ date: '2026-01-15', cents: 500 });
    const open = unwrap(await startConfirmationRun(f.deps, ctx, { year: 2026 }));
    expect(err(await sendConfirmationRunEmails(f.deps, ctx, { runId: open.id }))).toMatchObject({ type: 'conflict', code: 'runNotFinished' });
  });

  it('has an agent tool that names the lock', () => {
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_confirmation_run_mail');
    expect(tool?.description).toMatch(/dms\.send/);
  });
});

describe('confirmationRunDispatchState (Handoff 2b E3, Schritt „Ergebnis“)', () => {
  it('splits the run into mail and post with state, reason and done', async () => {
    const { f, ctx, runId, annaId } = await fixture(true);
    const before = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(before.mailState).toEqual({ kind: 'ready', redirectTo: null });
    expect(before.mail).toEqual([expect.objectContaining({ contactId: annaId, name: 'Anna Alpha', state: 'notQueued', address: 'anna@example.org', outboxId: null })]);
    expect(before.post).toEqual([expect.objectContaining({ contactId: f.erika.id, reason: 'noEmail', dispatched: false })]);
    expect(before.done).toBe(false);

    unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId }));
    const queued = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(queued.mail[0]).toMatchObject({ state: 'queued', outboxId: expect.any(String) });

    // „Versand vermerken …“ an der Post-Zeile.
    const postDoc = queued.post[0]!.documentId;
    expect(unwrap(await markRunPostConfirmations(f.deps, ctx, { runId, sentAt: '2026-03-20', documentIds: [postDoc] }))).toEqual({ count: 1 });
    const marked = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(marked.post[0]!.dispatched).toBe(true);
    expect(marked.done).toBe(false);
    expect(err(await markRunPostConfirmations(f.deps, ctx, { runId, sentAt: '2026-03-20', documentIds: [postDoc] }))).toMatchObject({ type: 'conflict', code: 'dispatchNothingMachine' });
  });

  it('puts everything into post without the machine procedure', async () => {
    const { f, ctx, runId } = await fixture(false);
    const state = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(state.mail).toEqual([]);
    expect(state.post.map((p) => p.reason)).toEqual(['notMachineProcedure', 'notMachineProcedure']);
  });

  it('prints the post group as one PDF', async () => {
    const { f, ctx, runId } = await fixture(true);
    f.deps.pdf = { ...f.deps.pdf, merge: async (files: Uint8Array[]) => new Uint8Array(files.length) };
    const bundle = unwrap(await readRunBundle(f.deps, ctx, { runId, part: 'post' }));
    expect(bundle.count).toBe(1);
    expect(bundle.filename).toMatch(/per-post\.pdf$/);
  });

  it('needs finance.read and validates', async () => {
    const { f, ctx, runId } = await fixture(true);
    expect(err(await confirmationRunDispatchState(f.deps, { ...ctx, permissions: new Set() }, { runId }))).toMatchObject({ type: 'forbidden' });
    expect(err(await confirmationRunDispatchState(f.deps, ctx, {}))).toMatchObject({ type: 'validation' });
    expect(err(await markRunPostConfirmations(f.deps, { ...ctx, permissions: new Set(['finance.read']) }, { runId, sentAt: '2026-03-20' }))).toMatchObject({ type: 'forbidden' });
    expect(FINANCE_MCP_TOOLS.some((t) => t.name === 'finance_confirmation_run_dispatch_state')).toBe(true);
  });
});

/**
 * Plan U4 Task 2 (Nachtrag MCP-Test § 2): „Per Post schicken“ je Zeile der Mail-Gruppe und „Zurück zu E-Mail“, solange
 * nicht vermerkt — derselbe Weg der Akte wie bei den Läufen der Mitglieder.
 */
describe('moveConfirmationRunLetters', () => {
  it('moves a waiting line into the post group with reason manual and back; the counts follow', async () => {
    const { f, ctx, runId } = await fixture(true);
    const doc = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId })).mail[0]!.documentId;
    expect(unwrap(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [doc], to: 'post' }))).toEqual({ count: 1 });
    const moved = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(moved.mail).toEqual([]);
    expect(moved.post.find((p) => p.documentId === doc)).toMatchObject({ reason: 'manual', dispatched: false });
    expect(JSON.parse(String(auditEntry(f.deps, 'finance.confirmationRun.toPost').params))).toMatchObject({ year: 2026, count: 1 });
    // Was von Hand in der Post-Gruppe steht, geht beim Senden nicht per E-Mail.
    expect(unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId })).queued).toBe(0);
    expect(unwrap(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [doc], to: 'email' }))).toEqual({ count: 1 });
    expect(unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId })).mail).toEqual([expect.objectContaining({ documentId: doc, state: 'notQueued' })]);
    expect(JSON.parse(String(auditEntry(f.deps, 'finance.confirmationRun.toEmail').params))).toMatchObject({ year: 2026, count: 1 });
  });

  it('withdraws a queued mail; refuses one being sent; back only without a dispatch note', async () => {
    const { f, ctx, runId } = await fixture(true);
    unwrap(await sendConfirmationRunEmails(f.deps, ctx, { runId }));
    const doc = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId })).mail[0]!.documentId;
    f.deps.db.update(dmsMailOutbox).set({ status: 'sending' }).run();
    expect(err(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [doc], to: 'post' }))).toMatchObject({ type: 'conflict', code: 'mailNotPending' });
    f.deps.db.update(dmsMailOutbox).set({ status: 'failed' }).run();
    unwrap(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [doc], to: 'post' }));
    expect(outbox(f)[0]!.status).toBe('withdrawn');
    unwrap(await markRunPostConfirmations(f.deps, ctx, { runId, sentAt: '2026-03-20', documentIds: [doc] }));
    expect(err(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [doc], to: 'email' }))).toMatchObject({ type: 'conflict', code: 'mailAlreadyDispatched' });
  });

  it('a line in the post group by the plan names that reason, not the preference of the contact (U7)', async () => {
    const { f, ctx, runId } = await fixture(false);
    const line = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId })).post[0]!;
    expect(line.reason).toBe('notMachineProcedure');
    expect(err(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: [line.documentId], to: 'post' }))).toMatchObject({ type: 'conflict', code: 'mailRecipientPost', params: { reason: 'notMachineProcedure' } });
  });

  it('with e-mail off every line goes by post with reason mailOff', async () => {
    const { f, ctx, runId } = await fixture(true);
    f.deps.mail = fakeMailTransport({ state: { kind: 'off' } });
    const state = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId }));
    expect(state.mail).toEqual([]);
    expect(state.post.map((p) => p.reason)).toEqual(['mailOff', 'mailOff']);
  });

  it('needs finance.donationsIssue, a document of the run and has an agent tool', async () => {
    const { f, ctx, runId } = await fixture(true);
    const doc = unwrap(await confirmationRunDispatchState(f.deps, ctx, { runId })).mail[0]!.documentId;
    expect(err(await moveConfirmationRunLetters(f.deps, { ...ctx, permissions: new Set(['finance.read']) }, { runId, documentIds: [doc], to: 'post' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await moveConfirmationRunLetters(f.deps, ctx, { runId, documentIds: ['01NOPE'], to: 'post' }))).toMatchObject({ type: 'notFound' });
    expect(FINANCE_MCP_TOOLS.some((t) => t.name === 'finance_confirmation_run_move')).toBe(true);
  });
});
