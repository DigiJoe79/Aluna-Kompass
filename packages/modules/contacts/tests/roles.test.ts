import { coreModule, defineModule, type ModuleManifest } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { writeSettingInternal } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactRoleDefinitions } from '../src/roles';

const financeLike: ModuleManifest = defineModule({
  key: 'finance',
  version: '1',
  permissions: ['finance.view'],
  dependsOn: ['contacts'],
  contactRoles: [{ key: 'donor', retention: 'statutory10Y' }],
});

const otherFinanceLike: ModuleManifest = defineModule({
  key: 'finance-2',
  version: '1',
  permissions: ['finance2.view'],
  dependsOn: ['contacts'],
  contactRoles: [{ key: 'donor', retention: 'consent' }],
});

const enable = (deps: ReturnType<typeof createTestDeps>, keys: string[]) => {
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', keys, 'test.enable');
  });
};

describe('contactRoleDefinitions', () => {
  it('brings the general roles of the contacts module', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    enable(deps, ['contacts']);
    const roles = contactRoleDefinitions(deps);
    expect([...roles.keys()].sort()).toEqual(['authority', 'interested', 'partner', 'service']);
    expect(roles.get('authority')!.retention).toBe('permanent');
  });

  it('takes roles from other enabled modules', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike] });
    enable(deps, ['contacts', 'finance']);
    expect(contactRoleDefinitions(deps).get('donor')!.retention).toBe('statutory10Y');
  });

  it('ignores roles of a disabled module', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike] });
    enable(deps, ['contacts']);
    expect(contactRoleDefinitions(deps).has('donor')).toBe(false);
  });

  it('throws when two enabled modules declare the same role key', () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike, otherFinanceLike] });
    enable(deps, ['contacts', 'finance', 'finance-2']);
    expect(() => contactRoleDefinitions(deps)).toThrow(/donor/);
  });
});
