import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { coreModule, defineModule } from '../src';
import { login } from '../src/auth/login';
import { dashboardLayouts, rolePermissions, roles, users } from '../src/db/schema';
import { seedDevelopment } from '../src/seed/seed';
import { readSetting } from '../src/settings/service';
import { createTestDeps } from '../src/testing';

describe('seedDevelopment', () => {
  it('creates an admin, example roles and users, and is idempotent', async () => {
    const deps = createTestDeps({ env: 'development' });
    const first = await seedDevelopment(deps);
    const second = await seedDevelopment(deps);
    expect(second).toEqual(first);
    expect(deps.db.select().from(roles).all().map((r) => r.name).sort()).toEqual(['Administration', 'Kassenprüfer', 'Schatzmeisterin', 'Schriftführung']);
    expect(deps.db.select().from(users).all()).toHaveLength(4);
    const session = await login(deps, { email: first.adminEmail, password: first.adminPassword, ipAddress: null, requestId: 'R' });
    expect(session.ok).toBe(true);
  });


  it('refuses to run in production', async () => {
    const deps = createTestDeps({ env: 'production' });
    await expect(seedDevelopment(deps)).rejects.toThrow(/production/);
  });

  it('enables all installed non-core modules', async () => {
    const finance = defineModule({ key: 'finance', version: '0', permissions: ['finance.view'] });
    const deps = createTestDeps({ env: 'development', manifests: [coreModule, finance] });
    await seedDevelopment(deps);
    expect(readSetting(deps, 'modules.enabled')).toEqual(['finance']);
  });

  it('executes manifest seed hooks for modules', async () => {
    let called = false;
    const testMod = defineModule({
      key: 'testmod',
      version: '0',
      permissions: ['testmod.view'],
      seed: async () => {
        called = true;
      },
    });
    const deps = createTestDeps({ env: 'development', manifests: [coreModule, testMod] });
    await seedDevelopment(deps);
    expect(called).toBe(true);
  });

  it('gibt Jonas Feld eine eigene Startseite aus den Kacheln, die er sehen darf', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    const jonas = deps.db.select().from(users).where(eq(users.email, 'jonas@kompass.local')).get()!;
    const row = deps.db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, jonas.id)).get();
    expect(row).toBeDefined();
    // Nur der Kern ist installiert: Fällig (30 Tage) und Backup; Unversandt gehört der Akte und fehlt hier.
    expect(JSON.parse(row!.tiles)).toEqual([
      { module: 'core', key: 'followUps', options: { horizonDays: '30', onlyMine: false } },
      { module: 'core', key: 'backup', options: {} },
    ]);
  });

  it('gibt der Schatzmeisterin nur Rechte, die die Registry kennt', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    const role = deps.db.select().from(roles).where(eq(roles.name, 'Schatzmeisterin')).get()!;
    const keys = deps.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id)).all().map((r) => r.permissionKey).sort();
    expect(keys).toEqual(['audit.view', 'backup.export', 'documents.export', 'followUps.manage', 'followUps.view', 'media.upload']);
  });
});
