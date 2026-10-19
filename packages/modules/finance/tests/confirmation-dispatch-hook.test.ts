import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { fakeMailTransport, systemContext } from '@kompass/core/testing';
import { setContactChannels } from '@kompass/module-contacts';
import { processOutbox, queueDocumentEmailsInternal, recordDispatch } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { financeConfirmations } from '../src/schema';
import { donationFixture, err } from './donation-fixture';

/**
 * Haken `documentDispatched`: Der Versandvermerk der Akte — von Hand oder
 * durch den Mailversand — setzt auch den Versand der Bestätigung zu diesem
 * Dokument, damit ein Storno danach nach dem Rückruf fragt. Heute ist der 2026-03-20.
 */
async function fixture() {
  const f = await donationFixture({ machine: true });
  const { line } = await f.donate({ cents: 4200 });
  const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
  const ctx: CallContext = { ...f.ctx, permissions: new Set([...f.ctx.permissions, 'dms.create', 'dms.view', 'dms.send']) };
  const row = () => f.deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, confirmation.id)).get()!;
  return { f, ctx, confirmation, row };
}

describe('documentDispatched', () => {
  it('a sent e-mail marks the confirmation as sent, and voiding then asks for the recall', async () => {
    const { f, ctx, confirmation, row } = await fixture();
    const mail = fakeMailTransport();
    f.deps.mail = mail;
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'dms.mail.fromAddress', 'post@example.org'));
    const manage: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
    unwrap(await setContactChannels(f.deps, manage, { id: f.erika.id, channels: [{ kind: 'email', value: 'erika@example.org', isPrimary: true }] }));
    f.deps.db.transaction((tx) => queueDocumentEmailsInternal(tx, f.deps, ctx, { items: [{ documentId: confirmation.documentId, contactId: f.erika.id }] }));
    expect(row().sentAt).toBeNull();

    expect((await processOutbox(f.deps)).sent).toBe(1);
    expect(row()).toMatchObject({ sentAt: '2026-03-20', sentVia: 'email' });
    expect(err(await voidConfirmation(f.deps, ctx, { id: confirmation.id, note: 'x', alreadySent: false }))).toMatchObject({ type: 'conflict', code: 'confirmationWasSent' });
  });

  it('a dispatch note by hand marks it as well; a second note does not change it', async () => {
    const { f, ctx, confirmation, row } = await fixture();
    f.deps.clock.set('2026-03-21T10:00:00.000Z');
    unwrap(await recordDispatch(f.deps, ctx, { id: confirmation.documentId, sentAt: '2026-03-20', sentVia: 'inPerson' }));
    expect(row()).toMatchObject({ sentAt: '2026-03-20', sentVia: 'handed' });
    expect(err(await voidConfirmation(f.deps, ctx, { id: confirmation.id, note: 'x', alreadySent: false }))).toMatchObject({ type: 'conflict', code: 'confirmationWasSent' });

    unwrap(await recordDispatch(f.deps, ctx, { id: confirmation.documentId, sentAt: '2026-03-21', sentVia: 'post' }));
    expect(row()).toMatchObject({ sentAt: '2026-03-20', sentVia: 'handed' });
  });
});
