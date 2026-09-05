import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { readAllSettings, readSetting, setSetting } from '../src/settings/service';
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
