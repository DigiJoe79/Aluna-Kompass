import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { resolveRecipient } from '../src/recipients';
import { setupWithTypes } from './helpers';

describe('resolveRecipient', () => {
  it('macht aus dem recipient-Link einen Anschriftsblock', async () => {
    const { deps, ctx } = setupWithTypes();
    const contact = await createContact(deps, ctx, {
      kind: 'person',
      lastName: 'Muster',
      firstName: 'Erika',
      street: 'Weg 1',
      postalCode: '12345',
      city: 'Stadt',
    });
    if (!contact.ok) throw new Error('setup');
    const draft = await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'Test',
      body: 'x',
      links: [{ entityType: 'contact', entityId: contact.value.id, role: 'recipient' }],
    });
    if (!draft.ok) throw new Error('setup');
    const block = resolveRecipient(deps, draft.value.id);
    expect(block).toContain('Erika Muster');
    expect(block).toContain('12345 Stadt');
  });

  it('bleibt leer, wenn kein Empfänger verknüpft ist', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'x' });
    if (!draft.ok) throw new Error('setup');
    expect(resolveRecipient(deps, draft.value.id)).toBe('');
  });
});
