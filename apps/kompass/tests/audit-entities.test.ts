import { coreModule, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { auditEntityLabels } from '@/lib/audit-entities';

/**
 * Befund 48: Das Protokoll trägt bei Kontakten nur die ID. Die Ansicht löst den
 * Namen live auf, solange es den Kontakt gibt; ein gelöschter zeigt, dass er
 * gelöscht ist — der Name ist mit ihm verschwunden.
 */
describe('auditEntityLabels', () => {
  it('löst den Namen eines bestehenden Kontakts live auf und markiert einen gelöschten', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    const userId = insertUser(deps, {});
    const ctx = ctxWith(['contacts.view', 'contacts.manage', 'audit.view'], userId);
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts'], 'test.enable'));
    const contact = await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Muster' });
    if (!contact.ok) throw new Error('setup');

    const labels = auditEntityLabels(deps, ctx, [
      { id: 'E1', entityType: 'contact', entityId: contact.value.id },
      { id: 'E2', entityType: 'contact', entityId: 'GELOESCHT' },
      { id: 'E3', entityType: 'setting', entityId: 'organization.name' },
    ]);
    expect(labels).toEqual({
      E1: { state: 'ok', label: 'Erika Muster' },
      E2: { state: 'missing' },
    });
  });
});
