import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { auditLog } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { enabledManifests, isModuleEnabled, listModules, setModuleEnabled } from '../src/modules/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

const finance = defineModule({ key: 'finance', version: '0.1.0', permissions: ['finance.view'] });
const website = defineModule({ key: 'website', version: '0.1.0', permissions: ['website.view'], dependsOn: ['finance'] });
const admin = ctxWith(['modules.manage']);

describe('modules service', () => {
  it('lists installed modules with core locked and enabled', () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    expect(listModules(deps)).toEqual([
      { key: 'core', version: '0.1.0', enabled: true, locked: true, dependsOn: [] },
      { key: 'finance', version: '0.1.0', enabled: false, locked: false, dependsOn: [] },
      { key: 'website', version: '0.1.0', enabled: false, locked: false, dependsOn: ['finance'] },
    ]);
    expect(isModuleEnabled(deps, 'core')).toBe(true);
    expect(enabledManifests(deps).map((m) => m.key)).toEqual(['core']);
  });

  it('enables and disables modules with audit entries', async () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    expect(unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: true })).enabled).toBe(true);
    expect(enabledManifests(deps).map((m) => m.key)).toEqual(['core', 'finance']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: false }));
    expect(isModuleEnabled(deps, 'finance')).toBe(false);
    expect(deps.db.select().from(auditLog).all().map((e) => e.action)).toEqual(['modules.enable', 'modules.disable']);
  });

  it('guards core, dependencies, unknown keys and permission', async () => {
    const deps = createTestDeps({ manifests: [coreModule, finance, website] });
    const core = await setModuleEnabled(deps, admin, { key: 'core', enabled: false });
    expect(core.ok === false && core.error.type === 'conflict' && core.error.code === 'moduleLocked').toBe(true);
    const dep = await setModuleEnabled(deps, admin, { key: 'website', enabled: true });
    expect(dep.ok === false && dep.error.type === 'conflict' && dep.error.code === 'moduleDependencyInactive').toBe(true);
    unwrap(await setModuleEnabled(deps, admin, { key: 'finance', enabled: true }));
    unwrap(await setModuleEnabled(deps, admin, { key: 'website', enabled: true }));
    const required = await setModuleEnabled(deps, admin, { key: 'finance', enabled: false });
    expect(required.ok === false && required.error.type === 'conflict' && required.error.code === 'moduleRequiredByOthers').toBe(true);
    const unknown = await setModuleEnabled(deps, admin, { key: 'animals', enabled: true });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const denied = await setModuleEnabled(deps, ctxWith(['settings.manage']), { key: 'finance', enabled: false });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('refuses to enable a module whose contact roles collide with an active module', async () => {
    const modA = defineModule({ key: 'mod-a', version: '0.1.0', permissions: [], contactRoles: [{ key: 'donor', retention: 'statutory10Y' }] });
    const modB = defineModule({ key: 'mod-b', version: '0.1.0', permissions: [], contactRoles: [{ key: 'donor', retention: 'consent' }] });
    const deps = createTestDeps({ manifests: [coreModule, modA, modB] });
    unwrap(await setModuleEnabled(deps, admin, { key: 'mod-a', enabled: true }));

    const res = await setModuleEnabled(deps, admin, { key: 'mod-b', enabled: true });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'contactRoleConflict').toBe(true);
    if (!res.ok) {
      expect(res.error.message).toContain('donor');
      expect(res.error.message).toContain('mod-a');
      expect(res.error.message).toContain('mod-b');
    }
    expect(isModuleEnabled(deps, 'mod-b')).toBe(false);
  });
});
