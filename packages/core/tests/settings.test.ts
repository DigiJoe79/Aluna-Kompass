import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule } from '../src/core-module';
import { auditLog } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { CORE_SETTINGS } from '../src/settings/core';
import { readAllSettings, readSetting, setSetting, writeSettingInternal } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';

describe('settings service', () => {
  it('returns registered defaults when nothing is stored', () => {
    const deps = createTestDeps();
    expect(readSetting(deps, 'organization.country')).toBe('DE');
    expect(readSetting(deps, 'modules.enabled')).toEqual([]);
    expect(readAllSettings(deps)['branding.activeTheme']).toBe('default');
  });

  it('throws for unknown keys on read (programming error, not user error)', () => {
    const deps = createTestDeps();
    expect(() => readSetting(deps, 'nope.key')).toThrow(/unknown setting/);
  });

  it('stores a valid value and writes an audit entry with before/after', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'organization.name',
      value: 'Musterverein e.V.',
    });
    expect(result).toEqual({ ok: true, value: { key: 'organization.name', value: 'Musterverein e.V.' } });
    expect(readSetting(deps, 'organization.name')).toBe('Musterverein e.V.');
    const entries = deps.db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: '"Neuer Verein"',
      after: '"Musterverein e.V."',
    });
  });

  it('rejects invalid values with field issues and stores nothing', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'organization.email',
      value: 'not-an-email',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    expect(deps.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it('rejects unknown keys as validation error and systemOnly keys as conflict', async () => {
    const deps = createTestDeps();
    const unknown = await setSetting(deps, ctxWith(['settings.manage']), { key: 'x.y', value: 1 });
    expect(unknown.ok === false && unknown.error.type === 'validation').toBe(true);
    const systemOnly = await setSetting(deps, ctxWith(['settings.manage']), {
      key: 'system.lastImportAt',
      value: '2026-01-01T00:00:00.000Z',
    });
    expect(systemOnly.ok === false && systemOnly.error.type === 'conflict' && systemOnly.error.code === 'settingSystemOnly').toBe(true);
  });

  it('requires settings.manage', async () => {
    const deps = createTestDeps();
    const result = await setSetting(deps, ctxWith(['users.manage']), { key: 'organization.name', value: 'X' });
    expect(result).toEqual({ ok: false, error: { type: 'forbidden', permission: 'settings.manage' } });
  });
});

describe('organization.foundedYear', () => {
  it('accepts a four digit year, rejects anything else, and defaults to empty', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['settings.manage']);
    expect(readSetting(deps, 'organization.foundedYear')).toBe('');
    expect(await setSetting(deps, ctx, { key: 'organization.foundedYear', value: '2026' })).toEqual({
      ok: true,
      value: { key: 'organization.foundedYear', value: '2026' },
    });
    for (const bad of ['26', 'zweitausend', '20260', '1799']) {
      expect((await setSetting(deps, ctx, { key: 'organization.foundedYear', value: bad })).ok, bad).toBe(false);
    }
    // Leer bleibt erlaubt: der Verein muss das Jahr nicht pflegen.
    expect((await setSetting(deps, ctx, { key: 'organization.foundedYear', value: '' })).ok).toBe(true);
  });
});

describe('bank details managed by finance', () => {
  it('the bank details of the association are managed by the finance module once it is on', () => {
    for (const key of ['organization.iban', 'organization.bic', 'organization.bankName']) expect(CORE_SETTINGS.find((s) => s.key === key)).toMatchObject({ managedBy: 'finance' });
  });
});

describe('managedBy and uiOnly', () => {
  const owner = defineModule({ key: 'owner', version: '0', permissions: [] });
  const host = defineModule({
    key: 'host',
    version: '0',
    permissions: [],
    settings: [
      { key: 'host.taxOffice', schema: z.string(), default: '', managedBy: 'owner' },
      { key: 'host.allowRobots', schema: z.boolean(), default: false, uiOnly: true },
    ],
  });
  const admin = ctxWith(['settings.manage']);
  const enable = (deps: ReturnType<typeof createTestDeps>, keys: string[]) =>
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, admin, 'modules.enabled', keys, 'test.enable'));

  it('refuses a managed setting while the managing module is on, and only then', async () => {
    const deps = createTestDeps({ manifests: [coreModule, owner, host] });
    enable(deps, ['host']);
    expect((await setSetting(deps, admin, { key: 'host.taxOffice', value: 'Jülich' })).ok).toBe(true);
    enable(deps, ['host', 'owner']);
    const res = await setSetting(deps, admin, { key: 'host.taxOffice', value: 'Aachen' });
    expect(res.ok ? null : res.error).toEqual({ type: 'conflict', code: 'settingManaged', message: 'owner' });
    const internal = deps.db.transaction((tx) => writeSettingInternal(tx, deps, admin, 'host.taxOffice', 'Düren'));
    expect(internal.ok).toBe(true);
  });

  it('refuses a uiOnly setting over mcp and accepts it over ui and system', async () => {
    const deps = createTestDeps({ manifests: [coreModule, host] });
    const viaMcp = await setSetting(deps, { ...admin, channel: 'mcp' }, { key: 'host.allowRobots', value: true });
    expect(viaMcp.ok ? null : viaMcp.error).toEqual({ type: 'conflict', code: 'settingUiOnly', message: 'host.allowRobots' });
    expect((await setSetting(deps, admin, { key: 'host.allowRobots', value: true })).ok).toBe(true);
    expect((await setSetting(deps, { ...admin, channel: 'system' }, { key: 'host.allowRobots', value: false })).ok).toBe(true);
  });
});
