import { coreModule, unwrap, writeSettingInternal, type CallContext, type Deps, type MailState } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, fakeMailTransport, insertUser, systemContext, TEST_NOW } from '@kompass/core/testing';
import { contactsModule, createContact, setContactChannels } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { linkDocumentInternal } from '../src/linked';
import { sendDocuments } from '../src/mail/outbox';
import { processOutbox, purgeOutboxAddresses, sanitizeServerText } from '../src/mail/sender';
import { dmsModule } from '../src/manifest';
import { dmsMailOutbox, documents } from '../src/schema';
import { ALL_DMS, fileFixture, seedTypes } from './helpers';

const MINUTE = 60_000;

function setup(state?: MailState) {
  const mail = fakeMailTransport(state ? { state } : {});
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], mail });
  seedTypes(deps);
  const userId = insertUser(deps, { name: 'Test', email: 'kassenwart@example.org' });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, systemContext(), 'organization.name', 'Beispielverein');
    writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'post@example.org');
  });
  return { deps, ctx: ctxWith([...ALL_DMS, 'dms.send', 'contacts.manage', 'contacts.view'], userId), mail, userId };
}

async function queuedLetter(deps: Deps, ctx: CallContext, n = 1) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const contact = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Kim', lastName: `Nummer${i}` }));
    unwrap(await setContactChannels(deps, ctx, { id: contact.id, channels: [{ kind: 'email', value: `kim${i}@example.org`, isPrimary: true }] }));
    const doc = await fileFixture(deps, ctx);
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'contact', entityId: contact.id, role: 'recipient' }));
    ids.push(doc.id);
  }
  unwrap(await sendDocuments(deps, ctx, { documentIds: ids }));
  return ids;
}

const rows = (deps: Deps) => deps.db.select().from(dmsMailOutbox).all();

describe('Sender des Ausgangskorbs', () => {
  it('entfernt Adressen aus dem Text des Servers', () => {
    expect(sanitizeServerText('550 5.1.1 <anna@example.org>: user unknown')).toBe('550 5.1.1 <…>: user unknown');
    expect(sanitizeServerText('x'.repeat(300))).toHaveLength(200);
  });

  it('sendet und vermerkt den Versand am Dokument erst danach', async () => {
    const { deps, ctx, mail, userId } = setup();
    const [docId] = await queuedLetter(deps, ctx);
    expect(deps.db.select().from(documents).where(eq(documents.id, docId!)).get()!.sentVia).toBeNull();

    const result = await processOutbox(deps);
    expect(result).toEqual({ sent: 1, failed: 0, waiting: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'kim0@example.org', subject: 'Fixture', from: { address: 'post@example.org', name: 'Beispielverein' } });
    expect(mail.sent[0]!.text).toContain('Kim Nummer0');
    expect(mail.sent[0]!.attachment?.filename).toMatch(/\.pdf$/);
    const [row] = rows(deps);
    expect(row).toMatchObject({ status: 'sent', attempts: 1, sentAt: TEST_NOW, messageId: '<fake-1@example.org>' });
    const doc = deps.db.select().from(documents).where(eq(documents.id, docId!)).get()!;
    expect(doc).toMatchObject({ sentVia: 'email', sentAt: TEST_NOW.slice(0, 10) });

    const sent = auditEntry(deps, 'dms.mail.sent');
    expect(sent).toMatchObject({ userId, channel: 'system' });
    expect(JSON.parse(sent.params!)).toEqual({ documentNumber: doc.number });
    expect(auditEntry(deps, 'dms.dispatch').channel).toBe('system');
  });

  it('versucht nach 1 und 5 Minuten erneut, dann nicht zugestellt', async () => {
    const { deps, ctx, mail } = setup();
    await queuedLetter(deps, ctx);
    mail.failNext('connection', '421 <kim0@example.org> try later');
    mail.failNext('connection', '421 try later');
    mail.failNext('connection', '421 try later');

    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 0, waiting: 1 });
    expect(rows(deps)[0]).toMatchObject({ status: 'queued', attempts: 1, lastErrorCode: 'connection', lastErrorText: '421 <…> try later' });
    deps.clock.advance(30_000);
    await processOutbox(deps);
    expect(rows(deps)[0]!.attempts).toBe(1);
    deps.clock.advance(30_000);
    await processOutbox(deps);
    expect(rows(deps)[0]!.attempts).toBe(2);
    deps.clock.advance(4 * MINUTE);
    await processOutbox(deps);
    expect(rows(deps)[0]!.attempts).toBe(2);
    deps.clock.advance(MINUTE);
    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 1, waiting: 0 });
    expect(rows(deps)[0]).toMatchObject({ status: 'failed', attempts: 3, lastErrorCode: 'connection' });
    const failed = auditEntry(deps, 'dms.mail.failed');
    expect(JSON.parse(failed.params!)).toMatchObject({ code: 'connection' });
    expect(JSON.stringify(failed)).not.toContain('@');
    expect(mail.sent).toHaveLength(0);
  });

  it('hält die Grenze je Minute ein', async () => {
    const { deps, ctx, mail } = setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.ratePerMinute', 2));
    await queuedLetter(deps, ctx, 5);
    expect(await processOutbox(deps)).toEqual({ sent: 2, failed: 0, waiting: 3 });
    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 0, waiting: 3 });
    deps.clock.advance(MINUTE + 1);
    expect(await processOutbox(deps)).toEqual({ sent: 2, failed: 0, waiting: 1 });
    expect(mail.sent).toHaveLength(4);
  });

  /**
   * Befundliste 0.4.0, N5: Starb der Prozess zwischen der Annahme durch den Server und dem Vermerk `sent`, ging die
   * Mail nach zehn Minuten ein zweites Mal hinaus. Ob sie angekommen ist, weiß niemand — also kein neuer Versuch,
   * sondern `failed` mit Grund `interrupted`; „Erneut senden“ entscheidet ein Mensch.
   */
  it('stale sending becomes failed with reason interrupted instead of being sent again', async () => {
    const { deps, ctx, mail } = setup();
    await queuedLetter(deps, ctx);
    const [row] = rows(deps);
    // Der Prozess starb mitten im Senden.
    deps.db.update(dmsMailOutbox).set({ status: 'sending', sendingSince: TEST_NOW }).where(eq(dmsMailOutbox.id, row!.id)).run();
    deps.clock.advance(9 * MINUTE);
    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 0, waiting: 0 });
    expect(rows(deps)[0]!.status).toBe('sending');
    deps.clock.advance(2 * MINUTE);
    await processOutbox(deps);
    deps.clock.advance(10 * MINUTE);
    await processOutbox(deps);
    expect(rows(deps)[0]).toMatchObject({ status: 'failed', lastErrorCode: 'interrupted', sendingSince: null });
    expect(mail.sent).toHaveLength(0);
    expect(JSON.parse(auditEntry(deps, 'dms.mail.failed')!.params!)).toMatchObject({ code: 'interrupted' });
  });

  it('sendet nie zweimal gleichzeitig', async () => {
    const { deps, ctx, mail } = setup();
    await queuedLetter(deps, ctx);
    const [a, b] = await Promise.all([processOutbox(deps), processOutbox(deps)]);
    expect(a.sent + b.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('sperrt in der Testumgebung ohne Umleitung, ohne zu senden', async () => {
    const ready = setup();
    await queuedLetter(ready.deps, ready.ctx);
    // Dieselbe Datenbank, nun mit gesperrtem Transport — etwa nach einem Neustart ohne KOMPASS_MAIL_REDIRECT.
    const blocked = fakeMailTransport({ state: { kind: 'blocked', reason: 'noRedirect' } });
    const deps = { ...ready.deps, mail: blocked };
    expect(await processOutbox(deps)).toEqual({ sent: 0, failed: 0, waiting: 1 });
    expect(rows(deps)[0]!.status).toBe('blocked');
    expect(blocked.sent).toHaveLength(0);
    // Wieder eingerichtet: Der Eintrag läuft weiter.
    expect(await processOutbox(ready.deps)).toEqual({ sent: 1, failed: 0, waiting: 0 });
  });

  it('leert die Adresse nach 90 Tagen, der Vermerk bleibt', async () => {
    const { deps, ctx } = setup();
    const [docId] = await queuedLetter(deps, ctx);
    await processOutbox(deps);
    deps.clock.advance(89 * 24 * 60 * MINUTE);
    await purgeOutboxAddresses(deps);
    expect(rows(deps)[0]!.toAddress).toBe('kim0@example.org');
    deps.clock.advance(2 * 24 * 60 * MINUTE);
    await purgeOutboxAddresses(deps);
    expect(rows(deps)[0]).toMatchObject({ toAddress: '', status: 'sent' });
    expect(rows(deps)[0]!.addressPurgedAt).not.toBeNull();
    expect(deps.db.select().from(documents).where(eq(documents.id, docId!)).get()!.sentVia).toBe('email');
    expect(dmsModule.housekeeping).toBeDefined();
  });
});
