import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { linkedAccess, reservedLinkTypes } from '../src/modules/linked-access';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';
import { createTestDeps, TEST_NOW } from '../src/testing';

const probe = defineModule({ key: 'probe', version: '0', permissions: ['probe.read', 'probe.write'], linkedDocumentAccess: [{ entityType: 'probeThing', readPermission: 'probe.read', receivePermission: 'probe.write' }] });

describe('linkedDocumentAccess', () => {
  it('must name permissions of its own module', () => {
    expect(() => defineModule({ key: 'm', version: '0', permissions: ['m.read'], linkedDocumentAccess: [{ entityType: 'mThing', readPermission: 'other.read' }] })).toThrow(/foreign permission: other.read/);
  });

  it('is unique per entity type across modules', () => {
    const twin = defineModule({ key: 'twin', version: '0', permissions: ['twin.read'], linkedDocumentAccess: [{ entityType: 'probeThing', readPermission: 'twin.read' }] });
    expect(() => createRegistry([coreModule, probe, twin])).toThrow(/duplicate linked document type: probeThing/);
  });

  it('grants only while the module is on, but stays reserved when it is off', () => {
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    expect(linkedAccess(deps, 'probeThing')).toBeNull();
    expect(reservedLinkTypes(deps).has('probeThing')).toBe(true);
    deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['probe']), updatedAt: TEST_NOW }).run();
    expect(linkedAccess(deps, 'probeThing')).toMatchObject({ module: 'probe', readPermission: 'probe.read' });
  });
});
