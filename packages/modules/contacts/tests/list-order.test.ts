import { coreModule, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { createContact, listContacts } from '../src/service';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage', 'settings.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts'], 'test.enable');
  });
  return { deps, ctx, userId };
}

describe('listContacts: Sortierung', () => {
  it('sortiert nach Name, Ort und Art in beide Richtungen', async () => {
    const { deps, ctx } = setup();
    await createContact(deps, ctx, { kind: 'person', lastName: 'Zimmer', firstName: 'Anna', city: 'Aachen' });
    await createContact(deps, ctx, { kind: 'organization', name: 'Bauhof GmbH', city: 'Zwickau' });
    await createContact(deps, ctx, { kind: 'person', lastName: 'Meier', firstName: 'Kai', city: 'Mainz' });
    const byName = await listContacts(deps, ctx, { orderBy: { field: 'name', direction: 'asc' } });
    expect(byName.ok && byName.value.contacts.map((c) => c.lastName ?? c.name)).toEqual(['Bauhof GmbH', 'Meier', 'Zimmer']);
    const byCity = await listContacts(deps, ctx, { orderBy: { field: 'city', direction: 'desc' } });
    expect(byCity.ok && byCity.value.contacts.map((c) => c.city)).toEqual(['Zwickau', 'Mainz', 'Aachen']);
    const byKind = await listContacts(deps, ctx, { orderBy: { field: 'kind', direction: 'asc' } });
    expect(byKind.ok && byKind.value.contacts[0]?.kind).toBe('organization');
  });
});
