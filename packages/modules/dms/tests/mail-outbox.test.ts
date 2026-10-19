import { coreModule, unwrap, writeSettingInternal, type CallContext, type Deps, type MailState } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, fakeMailTransport, insertUser, systemContext, type FakeMailTransport } from '@kompass/core/testing';
import { contactsModule, createContact, setContactChannels } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { linkDocumentInternal } from '../src/linked';
import { documentMailDraft, listOutbox, previewSend, resendDocumentEmail, sendDocuments, sendTestMail, switchToPost } from '../src/mail/outbox';
import { dmsModule } from '../src/manifest';
import { dmsMailOutbox, documents } from '../src/schema';
import { ALL_DMS, fileFixture, seedTypes } from './helpers';

const PERMISSIONS = [...ALL_DMS, 'dms.send', 'contacts.view', 'contacts.manage'];

function setup(opts: { state?: MailState; email?: string } = {}) {
  const mail = fakeMailTransport(opts.state ? { state: opts.state } : {});
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], mail });
  seedTypes(deps);
  const userId = insertUser(deps, { name: 'Test', email: opts.email ?? 'kassenwart@example.org' });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, systemContext(), 'organization.name', 'Beispielverein');
    writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'post@example.org');
  });
  return { deps, ctx: ctxWith(PERMISSIONS, userId), mail, userId };
}

async function contactWith(deps: Deps, ctx: CallContext, lastName: string, email: string | null, preference: 'auto' | 'post' = 'auto') {
  const contact = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Kim', lastName, deliveryPreference: preference }));
  if (email) unwrap(await setContactChannels(deps, ctx, { id: contact.id, channels: [{ kind: 'email', value: email, isPrimary: true }] }));
  return contact.id;
}

async function letterTo(deps: Deps, ctx: CallContext, contactId: string) {
  const doc = await fileFixture(deps, ctx);
  deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'contact', entityId: contactId, role: 'recipient' }));
  return doc.id;
}

const outbox = (deps: Deps) => deps.db.select().from(dmsMailOutbox).all();

describe('Briefe per E-Mail einreihen', () => {
  it('zeigt je Dokument Empfänger, Weg und Grund', async () => {
    const { deps, ctx } = setup();
    const mailed = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    const wantsPost = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Post', 'kim.post@example.org', 'post'));
    const noAddress = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Ohne', null));
    const draft = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: 'Text' }));

    const preview = unwrap(await previewSend(deps, ctx, { documentIds: [mailed, wantsPost, noAddress, draft.id] }));
    expect(preview.mail).toEqual({ kind: 'ready', host: 'smtp.example.org' });
    expect(preview.items).toEqual([
      expect.objectContaining({ documentId: mailed, channel: 'email', address: 'kim.mail@example.org' }),
      expect.objectContaining({ documentId: wantsPost, channel: 'post', reason: 'preference' }),
      expect.objectContaining({ documentId: noAddress, channel: 'post', reason: 'noEmail' }),
      expect.objectContaining({ documentId: draft.id, channel: 'post', reason: 'notFinal', contactId: null }),
    ]);
  });

  it('lehnt zu große, stornierte und empfängerlose Dokumente beim Einreihen ab', async () => {
    const { deps, ctx } = setup();
    const big = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Gross', 'gross@example.org'));
    deps.db.update(documents).set({ fileBytes: 10 * 1024 * 1024 + 1 }).where(eq(documents.id, big)).run();
    const voided = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Storno', 'storno@example.org'));
    deps.db.update(documents).set({ status: 'voided' }).where(eq(documents.id, voided)).run();
    const lonely = (await fileFixture(deps, ctx)).id;

    const result = unwrap(await sendDocuments(deps, ctx, { documentIds: [big, voided, lonely] }));
    expect(result.queued).toBe(0);
    expect(result.post.map((p) => p.channel === 'post' && p.reason)).toEqual(['tooLarge', 'voided', 'noRecipient']);
    expect(outbox(deps)).toEqual([]);
  });

  it('ein storniertes Dokument ohne Empfänger heißt „storniert“, nicht „kein Empfänger“ (M26)', async () => {
    const { deps, ctx } = setup();
    const lonelyVoided = (await fileFixture(deps, ctx)).id;
    deps.db.update(documents).set({ status: 'voided' }).where(eq(documents.id, lonelyVoided)).run();
    expect(unwrap(await previewSend(deps, ctx, { documentIds: [lonelyVoided] })).items).toEqual([expect.objectContaining({ documentId: lonelyVoided, channel: 'post', reason: 'voided' })]);
  });

  it('reiht ein und protokolliert ohne Adresse', async () => {
    const { deps, ctx, userId } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    const result = unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    expect(result).toEqual({ queued: 1, post: [] });
    const [row] = outbox(deps);
    expect(row).toMatchObject({ documentId: doc, toAddress: 'kim.mail@example.org', subject: 'Fixture', status: 'queued', attempts: 0, queuedByUserId: userId });

    const entry = auditEntry(deps, 'dms.mail.queue');
    const number = deps.db.select().from(documents).where(eq(documents.id, doc)).get()!.number;
    expect(JSON.parse(entry.params!)).toEqual({ documentNumber: number });
    expect(entry.params).not.toContain('@');
    expect(entry.after ?? '').not.toContain('@');
  });

  it('nimmt für eine Person ohne eigene Adresse die ihrer Organisation (Spec § 4.1)', async () => {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Beispiel GmbH' }));
    unwrap(await setContactChannels(deps, ctx, { id: org.id, channels: [{ kind: 'email', value: 'info@beispiel.example', isPrimary: true }] }));
    const personId = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Kim', lastName: 'Bei', belongsToId: org.id })).id;
    const doc = await letterTo(deps, ctx, personId);
    expect(unwrap(await previewSend(deps, ctx, { documentIds: [doc] })).items).toEqual([expect.objectContaining({ documentId: doc, contactId: personId, channel: 'email', address: 'info@beispiel.example' })]);
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    expect(outbox(deps)[0]).toMatchObject({ documentId: doc, toAddress: 'info@beispiel.example' });
  });

  it('reiht dasselbe Dokument kein zweites Mal ein', async () => {
    const { deps, ctx } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    const second = unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    expect(second.queued).toBe(0);
    expect(outbox(deps)).toHaveLength(1);
  });

  it('lehnt ab, solange der Versand nicht eingerichtet oder gesperrt ist', async () => {
    for (const state of [{ kind: 'off' }, { kind: 'blocked', reason: 'noRedirect' }] as MailState[]) {
      const { deps, ctx } = setup({ state });
      const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
      const result = await sendDocuments(deps, ctx, { documentIds: [doc] });
      expect(!result.ok && result.error.type === 'conflict' && result.error.code).toBe('mailNotReady');
      expect(outbox(deps)).toEqual([]);
    }
  });

  it('nennt ohne Einrichtung im Plan den Grund mailOff', async () => {
    const { deps, ctx } = setup({ state: { kind: 'off' } });
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    const preview = unwrap(await previewSend(deps, ctx, { documentIds: [doc] }));
    expect(preview.items[0]).toMatchObject({ channel: 'post', reason: 'mailOff' });
  });

  it('sendet nur, wer das Recht hat, und nie über einen Agenten', async () => {
    const { deps, ctx, userId } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    const denied = await sendDocuments(deps, ctxWith(ALL_DMS, userId), { documentIds: [doc] });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const agent = await sendDocuments(deps, { ...ctx, channel: 'mcp' }, { documentIds: [doc] });
    expect(!agent.ok && agent.error.type === 'conflict' && agent.error.code).toBe('humanOnly');
    const invalid = await sendDocuments(deps, ctx, { documentIds: [] });
    expect(!invalid.ok && invalid.error.type).toBe('validation');
  });

  it('legt beim erneuten Senden eine neue Sendung an, die alte bleibt', async () => {
    const { deps, ctx } = setup();
    const contactId = await contactWith(deps, ctx, 'Mail', 'alt@example.org');
    const doc = await letterTo(deps, ctx, contactId);
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    const [first] = outbox(deps);
    deps.db.update(dmsMailOutbox).set({ status: 'failed', attempts: 3, lastErrorCode: 'rejected' }).where(eq(dmsMailOutbox.id, first!.id)).run();
    // Die Adresse ist inzwischen berichtigt: Die neue Sendung nimmt die aktuelle.
    unwrap(await setContactChannels(deps, ctx, { id: contactId, channels: [{ kind: 'email', value: 'neu@example.org', isPrimary: true }] }));

    const again = unwrap(await resendDocumentEmail(deps, ctx, { outboxId: first!.id }));
    const rows = outbox(deps);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first!.id)!.status).toBe('failed');
    expect(rows.find((r) => r.id === again.id)).toMatchObject({ status: 'queued', toAddress: 'neu@example.org', attempts: 0 });
    expect(auditEntry(deps, 'dms.mail.resend').params).not.toContain('@');

    const pending = await resendDocumentEmail(deps, ctx, { outboxId: again.id });
    expect(!pending.ok && pending.error.type === 'conflict' && pending.error.code).toBe('mailNotResendable');
  });

  it('stellt auf Post um und reiht danach nicht wieder ein', async () => {
    const { deps, ctx } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    const [row] = outbox(deps);
    unwrap(await switchToPost(deps, ctx, { outboxIds: [row!.id] }));
    expect(outbox(deps)[0]!.status).toBe('withdrawn');
    expect(auditEntry(deps, 'dms.mail.toPost')).toBeDefined();

    const again = unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    expect(again.queued).toBe(0);
    expect(again.post[0]).toMatchObject({ channel: 'post', reason: 'manual' });
    expect(outbox(deps)).toHaveLength(1);

    const twice = await switchToPost(deps, ctx, { outboxIds: [row!.id] });
    expect(!twice.ok && twice.error.type === 'conflict' && twice.error.code).toBe('mailNotPending');
  });

  it('sendet eine Testmail an die eigene Adresse, ohne Ausgangskorb', async () => {
    const without = setup({ email: 'kassenwart' });
    const refused = await sendTestMail(without.deps, without.ctx);
    expect(!refused.ok && refused.error.type === 'conflict' && refused.error.code).toBe('noUserEmail');

    const { deps, ctx, mail } = setup();
    const sent = unwrap(await sendTestMail(deps, ctx));
    expect(sent).toEqual({ address: 'kassenwart@example.org' });
    expect((mail as FakeMailTransport).sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'kassenwart@example.org', from: { address: 'post@example.org', name: 'Beispielverein' } });
    // Ohne Anhang: Ein leeres PDF zeigten Mailprogramme als weiße Seite unter dem Text (Joe 2026-10-18).
    expect(mail.sent[0]!.attachment).toBeUndefined();
    expect(outbox(deps)).toEqual([]);
    const entry = auditEntry(deps, 'dms.mail.test');
    expect(JSON.stringify(entry)).not.toContain('@');
  });

  it('listet den Ausgang mit Namen, neueste zuerst', async () => {
    const { deps, ctx } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc] }));
    const list = unwrap(await listOutbox(deps, ctx, {}));
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ documentId: doc, contactName: 'Kim Mail', status: 'queued', toAddress: 'kim.mail@example.org' });
    const viewer = await listOutbox(deps, ctxWith([], null), {});
    expect(!viewer.ok && viewer.error.type).toBe('forbidden');
  });
});

describe('Per E-Mail senden am Dokument (Handoff 2b E2)', () => {
  it('liefert Empfänger mit Weg, Begleittext, Anhang und Sendungen, neueste oben', async () => {
    const { deps, ctx } = setup();
    const kim = await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org');
    const doc = await letterTo(deps, ctx, kim);
    const wantsPost = await contactWith(deps, ctx, 'Post', 'kim.post@example.org', 'post');
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc, entityType: 'contact', entityId: wantsPost, role: 'recipient' }));

    const draft = unwrap(await documentMailDraft(deps, ctx, { documentId: doc }));
    expect(draft.subject).toBe('Fixture');
    expect(draft.fileName).toMatch(/\.pdf$/);
    expect(draft.mail).toEqual({ kind: 'ready', redirectTo: null, sender: true });
    expect(draft.recipients).toEqual([
      expect.objectContaining({ contactId: kim, name: 'Kim Mail', channel: 'email', address: 'kim.mail@example.org', via: 'self', body: expect.stringContaining('Kim Mail') }),
      expect.objectContaining({ contactId: wantsPost, name: 'Kim Post', channel: 'post', reason: 'preference' }),
    ]);
    expect(draft.sendings).toEqual([]);

    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc], contactIds: [kim] }));
    const again = unwrap(await documentMailDraft(deps, ctx, { documentId: doc }));
    expect(again.sendings).toEqual([expect.objectContaining({ contactId: kim, contactName: 'Kim Mail', status: 'queued', queuedByUserId: ctx.userId })]);
  });

  it('sendet nur an die gewählten Empfänger', async () => {
    const { deps, ctx } = setup();
    const a = await contactWith(deps, ctx, 'Eins', 'eins@example.org');
    const b = await contactWith(deps, ctx, 'Zwei', 'zwei@example.org');
    const doc = await letterTo(deps, ctx, a);
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc, entityType: 'contact', entityId: b, role: 'recipient' }));
    unwrap(await sendDocuments(deps, ctx, { documentIds: [doc], contactIds: [b] }));
    expect(outbox(deps).map((r) => r.contactId)).toEqual([b]);
  });

  it('filtert den Ausgang nach Dokument', async () => {
    const { deps, ctx } = setup();
    const kim = await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org');
    const one = await letterTo(deps, ctx, kim);
    const two = await letterTo(deps, ctx, kim);
    unwrap(await sendDocuments(deps, ctx, { documentIds: [one, two] }));
    expect(unwrap(await listOutbox(deps, ctx, { documentId: two })).items.map((i) => i.documentId)).toEqual([two]);
    deps.db.update(dmsMailOutbox).set({ runRef: 'membersFeeRun:R1' }).where(eq(dmsMailOutbox.documentId, one)).run();
    expect(unwrap(await listOutbox(deps, ctx, { runRef: 'membersFeeRun:R1' })).items.map((i) => i.documentId)).toEqual([one]);
    // Zeitraum: eine alte Sendung fällt aus den letzten 30 Tagen heraus.
    deps.db.update(dmsMailOutbox).set({ queuedAt: '2000-01-01T00:00:00.000Z' }).where(eq(dmsMailOutbox.documentId, one)).run();
    expect(unwrap(await listOutbox(deps, ctx, { days: 30 })).items.map((i) => i.documentId)).toEqual([two]);
  });

  it('verlangt dms.view', async () => {
    const { deps, ctx } = setup();
    const doc = await letterTo(deps, ctx, await contactWith(deps, ctx, 'Mail', 'kim.mail@example.org'));
    const denied = await documentMailDraft(deps, ctxWith([], ctx.userId), { documentId: doc });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.type).toBe('forbidden');
    const invalid = await documentMailDraft(deps, ctx, {});
    expect(invalid.ok).toBe(false);
  });
});
