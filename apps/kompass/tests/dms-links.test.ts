import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalsModule } from '@kompass/module-animals';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { resolveLinks } from '@/app/(shell)/dms/[id]/links';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, animalsModule] });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, userId };
}

describe('resolveLinks', () => {
  it('macht aus einem Bezug einen Namen und einen Weg dorthin', async () => {
    const { deps, userId } = setup();
    const ctx = ctxWith(['contacts.manage', 'contacts.view'], userId);
    const contact = await createContact(deps, ctx, { kind: 'person', lastName: 'Muster', firstName: 'Erika' });
    if (!contact.ok) throw new Error('setup');

    const [link] = await resolveLinks(deps, ctx, [{ id: 'L2', entityType: 'contact', entityId: contact.value.id, role: 'recipient' }]);
    expect(link?.label).toContain('Muster');
    expect(link?.href).toBe(`/contacts/${contact.value.id}`);
    expect(link?.reason).toBeNull();
  });

  it('unterscheidet „gibt es nicht mehr“ von „darfst du nicht sehen“', async () => {
    const { deps, userId } = setup();
    const ctx = ctxWith(['contacts.manage', 'contacts.view'], userId);
    const contact = await createContact(deps, ctx, { kind: 'person', lastName: 'Muster', firstName: 'Erika' });
    if (!contact.ok) throw new Error('setup');

    const [gone] = await resolveLinks(deps, ctx, [{ id: 'L1', entityType: 'contact', entityId: 'gibtsnicht', role: 'about' }]);
    expect(gone?.label).toBeNull();
    expect(gone?.reason).toBe('missing');

    // Derselbe Bezug, aber ohne Leserecht auf Kontakte.
    const blind = ctxWith(['dms.view'], userId);
    const [hidden] = await resolveLinks(deps, blind, [{ id: 'L2', entityType: 'contact', entityId: contact.value.id, role: 'recipient' }]);
    expect(hidden?.label).toBeNull();
    expect(hidden?.reason).toBe('forbidden');
  });

  it('fällt bei einem unbekannten Entitätstyp nicht um', async () => {
    const { deps, userId } = setup();
    const [link] = await resolveLinks(deps, ctxWith(['dms.view'], userId), [
      { id: 'L3', entityType: 'gibtsnicht', entityId: 'x', role: 'about' },
    ]);
    expect(link?.label).toBeNull();
    expect(link?.reason).toBe('missing');
  });
});
