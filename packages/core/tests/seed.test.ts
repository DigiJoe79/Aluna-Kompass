import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { coreModule, defineModule, AI_LABELING_ENABLED_KEY } from '../src';
import { login } from '../src/auth/login';
import { apiTokens, dashboardLayouts, rolePermissions, roles, users } from '../src/db/schema';
import { resolveApiToken } from '../src/auth/tokens';
import { SEED_MCP_USERS, seedDevelopment, seedMcpToken } from '../src/seed/seed';
import { readSetting, writeSettingInternal } from '../src/settings/service';
import { systemContext } from '../src/testing';
import { createTestDeps } from '../src/testing';

describe('seedDevelopment', () => {
  it('creates an admin, example roles and users, and is idempotent', async () => {
    const deps = createTestDeps({ env: 'development' });
    const first = await seedDevelopment(deps);
    const second = await seedDevelopment(deps);
    expect(second).toEqual(first);
    expect(deps.db.select().from(roles).all().map((r) => r.name).sort()).toEqual(['Administration', 'Geschäftsstelle', 'Interne Revision', 'Schriftführung']);
    expect(deps.db.select().from(users).all()).toHaveLength(4);
    const session = await login(deps, { email: first.adminEmail, password: first.adminPassword, ipAddress: null, requestId: 'R' });
    expect(session.ok).toBe(true);
  });


  it('gives Anna and Mira a fixed MCP token each — stable test conditions for two MCP servers, idempotent', async () => {
    const deps = createTestDeps({ env: 'test' });
    await seedDevelopment(deps);
    await seedDevelopment(deps);
    expect(SEED_MCP_USERS).toEqual(['admin@kompass.local', 'mira@kompass.local']);
    for (const email of SEED_MCP_USERS) {
      const token = seedMcpToken(deps.env, email);
      expect(token).toMatch(/^akx_test_seed-/);
      const user = deps.db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()!;
      expect(resolveApiToken(deps, token, { ipAddress: null, requestId: 'R' })?.userId).toBe(user.id);
    }
    expect(deps.db.select().from(apiTokens).all()).toHaveLength(2);
  });

  it('gives the invented association an address — every confirmation carries it (F6a)', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    expect([readSetting(deps, 'organization.street'), readSetting(deps, 'organization.postalCode'), readSetting(deps, 'organization.city')]).toEqual(['Vereinsweg 1', '12345', 'Musterstadt']);
  });

  it('fills register and contact of the invented association — the setup tile asks for nothing the core knows (Spec 2026-10-06 § 4)', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    expect([readSetting(deps, 'organization.registerCourt'), readSetting(deps, 'organization.registerNumber')]).toEqual(['Amtsgericht Musterstadt', 'VR 4711']);
    expect(readSetting<string>(deps, 'organization.foundedYear')).toMatch(/^20\d{2}$/);
    expect([readSetting(deps, 'organization.email'), readSetting(deps, 'organization.website')]).toEqual(['info@musterverein.example', 'https://musterverein.example']);
  });

  it('keeps an address someone already entered', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.city', 'Anderswo'));
    await seedDevelopment(deps);
    expect(readSetting(deps, 'organization.city')).toBe('Anderswo');
  });

  it('switches AI labeling on', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    expect(readSetting(deps, AI_LABELING_ENABLED_KEY)).toBe(true);
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

  it('runs the seedLast hooks after the seed hooks of every module, whatever the order of the manifests', async () => {
    const calls: string[] = [];
    const first = defineModule({ key: 'first', version: '0', permissions: ['first.view'], seed: async () => void calls.push('first.seed'), seedLast: async () => void calls.push('first.seedLast') });
    const second = defineModule({ key: 'second', version: '0', permissions: ['second.view'], seed: async () => void calls.push('second.seed') });
    const deps = createTestDeps({ env: 'development', manifests: [coreModule, first, second] });
    await seedDevelopment(deps);
    expect(calls).toEqual(['first.seed', 'second.seed', 'first.seedLast']);
  });

  it('gibt Jonas Feld eine eigene Startseite aus den Kacheln, die er sehen darf', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    const jonas = deps.db.select().from(users).where(eq(users.email, 'jonas@kompass.local')).get()!;
    const row = deps.db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, jonas.id)).get();
    expect(row).toBeDefined();
    // Nur der Kern ist installiert: Fällig (30 Tage) und Backup; Unversandt gehört der Akte und fehlt hier.
    // Gespeichert in Spalten (0.2.12): die flache Liste nach Reihenfolge auf drei verteilt, 2:1 daraus abgeleitet.
    const followUps = { module: 'core', key: 'followUps', options: { horizonDays: '30', onlyMine: false } };
    const backup = { module: 'core', key: 'backup', options: {} };
    expect(JSON.parse(row!.tiles)).toEqual({ v: 2, layout: 'thirds', arrangements: { thirds: [[followUps], [backup], []], 'wide-narrow': [[followUps, backup], []] } });
  });

  it('gibt jeder Rolle nur Rechte, die die Registry kennt — auch wenn ein Modul fehlt (156)', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    const keys = deps.db.select().from(rolePermissions).all().map((r) => r.permissionKey);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !deps.registry.permissionKeys.has(key))).toEqual([]);
  });
});
