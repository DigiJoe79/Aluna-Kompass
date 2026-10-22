import { coreModule, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, fakeMailTransport, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule, createContact, setContactChannels } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { linkDocumentInternal } from '../src/linked';
import { dmsModule } from '../src/manifest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';
import { dmsMailOutbox } from '../src/schema';
import { ALL_DMS, fileFixture, seedTypes } from './helpers';

const tool = (name: string) => {
  const found = DMS_MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

async function setup() {
  const mail = fakeMailTransport();
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], mail });
  seedTypes(deps);
  const userId = insertUser(deps, { name: 'Test', email: 'kassenwart@example.org' });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'post@example.org'));
  const ctx = ctxWith([...ALL_DMS, 'dms.send', 'contacts.manage', 'contacts.view'], userId);
  const contact = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Kim', lastName: 'Mail' }));
  unwrap(await setContactChannels(deps, ctx, { id: contact.id, channels: [{ kind: 'email', value: 'kim@example.org', isPrimary: true }] }));
  const doc = await fileFixture(deps, ctx);
  deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'contact', entityId: contact.id, role: 'recipient' }));
  return { deps, ctx, agent: { ...ctx, channel: 'mcp' as const }, documentId: doc.id };
}

describe('Agenten-Werkzeuge des Mailversands', () => {
  it('gibt es für Vorschau, Senden, Erneut senden, Post und den Ausgang', () => {
    for (const name of ['dms_send_preview', 'dms_send', 'dms_send_retry', 'dms_send_to_post', 'dms_outbox_list']) expect(tool(name).inputSchema).toBeDefined();
    expect(tool('dms_send').description).toMatch(/Human only/);
    expect(tool('dms_send_retry').description).toMatch(/Human only/);
  });

  it('ein Agent sieht die Vorschau und den Ausgang, sendet aber nie', async () => {
    const { deps, agent, documentId } = await setup();
    const preview = await tool('dms_send_preview').handler(deps, agent, { documentIds: [documentId] });
    expect(preview.ok).toBe(true);
    const sent = await tool('dms_send').handler(deps, agent, { documentIds: [documentId] });
    expect(!sent.ok && sent.error.type === 'conflict' && sent.error.code).toBe('humanOnly');
    expect(deps.db.select().from(dmsMailOutbox).all()).toEqual([]);
    const retry = await tool('dms_send_retry').handler(deps, agent, { outboxIds: ['X'] });
    expect(!retry.ok && retry.error.type === 'conflict' && retry.error.code).toBe('humanOnly');
    const list = await tool('dms_outbox_list').handler(deps, agent, {});
    expect(list.ok).toBe(true);
  });
});
