import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule } from '../src/core-module';
import { getDashboardLayout, listDashboardTiles, readDashboard, resetDashboardLayout, setDashboardLayout } from '../src/dashboard/service';
import type { DashboardTile } from '../src/dashboard/types';
import { auditLog, dashboardLayouts, settings as schemaSettings } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { setModuleEnabled } from '../src/modules/service';
import { readSetting } from '../src/settings/service';
import { auditEntry, createTestDeps, ctxWith, insertUser, TEST_NOW } from '../src/testing';

describe('backup.maxAgeDays', () => {
  it('has a default of 30 days', () => {
    const deps = createTestDeps();
    expect(readSetting<number>(deps, 'backup.maxAgeDays')).toBe(30);
  });
});

/** Ein Modul mit drei Kacheln: eine an, eine aus, eine mit Optionen, dazu eine, die wirft. */
const counter = (key: string, defaultOn: boolean, count: number): DashboardTile => ({
  key, permission: 'test.view', kind: 'count', defaultOn, options: z.object({}), load: () => ({ kind: 'count', count, href: `/${key}` }),
});
/**
 * Eigener Name mit expliziter Generik: In der Array-Literal-Position wäre der
 * Kontext `DashboardTile<Record<string, unknown>>` (Vorgabe des Typparameters),
 * und `o.rows` würde als `unknown` durchgereicht — wie bei den Kern-Kacheln in
 * `dashboard/tiles.ts` (`… as DashboardTile`).
 */
const withOptionsTile: DashboardTile<{ rows: number; onlyMine: boolean }> = {
  key: 'withOptions',
  permission: 'test.manage',
  kind: 'list',
  defaultOn: true,
  options: z.object({ rows: z.number().int().min(0).max(10).default(5), onlyMine: z.boolean().default(false) }),
  load: (_deps, _ctx, o) => ({ kind: 'list', lines: [], total: o.rows, href: null }),
};
const testModule = defineModule({
  key: 'test',
  version: '0',
  permissions: ['test.view', 'test.manage'],
  dashboardTiles: [
    counter('alpha', true, 1),
    counter('beta', false, 2),
    withOptionsTile as DashboardTile,
    { key: 'broken', permission: 'test.view', kind: 'status', defaultOn: false, options: z.object({}), load: () => { throw new Error('kaputt'); } },
  ],
});

function setup(permissions: string[] = ['test.view', 'test.manage']) {
  const deps = createTestDeps({ manifests: [coreModule, testModule] });
  deps.db.insert(schemaSettings).values({ key: 'modules.enabled', value: JSON.stringify(['test']), updatedAt: TEST_NOW }).run();
  const userId = insertUser(deps, { name: 'Anna' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}

describe('listDashboardTiles', () => {
  it('nennt nur Kacheln, für die der Nutzer das Recht hat, mit Optionsfeldern', async () => {
    const { deps } = setup(['test.view']);
    const res = await listDashboardTiles(deps, ctxWith(['test.view'], 'U'));
    expect(res.ok && res.value.map((t) => `${t.module}.${t.key}`)).toEqual(['test.alpha', 'test.beta', 'test.broken']);
  });

  it('liefert die Optionsfelder der Kachel', async () => {
    const { deps, ctx } = setup();
    const res = await listDashboardTiles(deps, ctx);
    const withOptions = res.ok ? res.value.find((t) => t.key === 'withOptions') : undefined;
    expect(withOptions).toMatchObject({ kind: 'list', defaultOn: true, options: [{ name: 'rows', type: 'integer', min: 0, max: 10, default: 5 }, { name: 'onlyMine', type: 'boolean', default: false }] });
  });

  it('weist ohne Sitzung ab', async () => {
    const { deps } = setup();
    const res = await listDashboardTiles(deps, ctxWith(['test.view'], null));
    expect(res.ok).toBe(false);
  });
});

describe('getDashboardLayout', () => {
  it('liefert ohne Zeile die Vorgabe: defaultOn-Kacheln in Manifest-Reihenfolge mit Optionsvorgaben', async () => {
    const { deps, ctx } = setup();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value).toEqual({
      custom: false,
      tiles: [
        { module: 'test', key: 'alpha', options: {} },
        { module: 'test', key: 'withOptions', options: { rows: 5, onlyMine: false } },
      ],
    });
  });

  it('lässt in der Vorgabe Kacheln ohne Recht weg', async () => {
    const { deps } = setup();
    const res = await getDashboardLayout(deps, ctxWith(['test.view'], 'U'));
    expect(res.ok && res.value.tiles.map((t) => t.key)).toEqual(['alpha']);
  });
});

describe('setDashboardLayout', () => {
  it('speichert Reihenfolge und Optionen, liest sie zurück und protokolliert Vorher/Nachher', async () => {
    const { deps, ctx, userId } = setup();
    const saved = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'withOptions', options: { rows: 10 } }, { module: 'test', key: 'beta' }] });
    expect(saved.ok && saved.value).toEqual({ custom: true, tiles: [{ module: 'test', key: 'withOptions', options: { rows: 10, onlyMine: false } }, { module: 'test', key: 'beta', options: {} }] });
    const read = await getDashboardLayout(deps, ctx);
    expect(read.ok && read.value.tiles.map((t) => t.key)).toEqual(['withOptions', 'beta']);
    const entry = auditEntry(deps, 'dashboard.setLayout');
    expect(entry.entityType).toBe('dashboardLayout');
    expect(entry.entityId).toBe(userId);
    expect(JSON.parse(entry.before!)).toBeNull();
    expect(JSON.parse(entry.after!)).toHaveLength(2);
  });

  it('lehnt eine unbekannte Kachel, eine ohne Recht und eine doppelte mit Pfad ab', async () => {
    const { deps } = setup();
    const ctx = ctxWith(['test.view'], insertUser(deps, {}));
    const unknown = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'nope' }] });
    expect(unknown.ok === false && unknown.error.type === 'validation' && unknown.error.issues[0]).toMatchObject({ path: 'tiles.0', message: 'unknownTile' });
    const forbiddenTile = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'withOptions' }] });
    expect(forbiddenTile.ok === false && forbiddenTile.error.type === 'validation' && forbiddenTile.error.issues[0]).toMatchObject({ path: 'tiles.0', message: 'forbiddenTile' });
    const twice = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'alpha' }, { module: 'test', key: 'alpha' }] });
    expect(twice.ok === false && twice.error.type === 'validation' && twice.error.issues[0]).toMatchObject({ path: 'tiles.1', message: 'duplicateTile' });
  });

  it('lehnt Optionen außerhalb des Schemas ab', async () => {
    const { deps, ctx } = setup();
    const res = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'withOptions', options: { rows: 99 } }] });
    expect(res.ok === false && res.error.type === 'validation' && res.error.issues[0]?.path).toBe('tiles.0.options.rows');
  });

  it('weist ohne Sitzung ab', async () => {
    const { deps } = setup();
    const res = await setDashboardLayout(deps, ctxWith(['test.view'], null), { tiles: [] });
    expect(res.ok).toBe(false);
  });

  it('lässt beim Lesen eine Kachel weg, deren Modul aus ist, und zeigt sie nach dem Einschalten wieder — ohne die Zeile zu ändern', async () => {
    const { deps, ctx } = setup();
    const admin = ctxWith(['modules.manage'], 'ADMIN');
    await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'alpha' }] });
    await setModuleEnabled(deps, admin, { key: 'test', enabled: false });
    const off = await getDashboardLayout(deps, ctx);
    expect(off.ok && off.value).toEqual({ custom: true, tiles: [] });
    await setModuleEnabled(deps, admin, { key: 'test', enabled: true });
    const on = await getDashboardLayout(deps, ctx);
    expect(on.ok && on.value.tiles.map((t) => t.key)).toEqual(['alpha']);
  });

  it('fällt bei einer gespeicherten Option, die das Schema nicht mehr kennt, auf die Vorgabe zurück', async () => {
    const { deps, ctx, userId } = setup();
    deps.db.insert(dashboardLayouts).values({ userId, tiles: JSON.stringify([{ module: 'test', key: 'withOptions', options: { rows: 'viele', onlyMine: true } }]), updatedAt: TEST_NOW }).run();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value.tiles[0]?.options).toEqual({ rows: 5, onlyMine: true });
  });
});

describe('resetDashboardLayout', () => {
  it('löscht die Zeile, protokolliert den gelöschten Stand und liefert die Vorgabe', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'beta' }] });
    const res = await resetDashboardLayout(deps, ctx);
    expect(res.ok && res.value.custom).toBe(false);
    expect(deps.db.select().from(dashboardLayouts).all()).toHaveLength(0);
    const entry = auditEntry(deps, 'dashboard.resetLayout');
    expect(JSON.parse(entry.before!)).toEqual([{ module: 'test', key: 'beta', options: {} }]);
  });

  it('ist ohne Zeile ein stiller Erfolg ohne Protokolleintrag', async () => {
    const { deps, ctx } = setup();
    const res = await resetDashboardLayout(deps, ctx);
    expect(res.ok).toBe(true);
    expect(deps.db.select().from(auditLog).all().map((e) => e.action)).not.toContain('dashboard.resetLayout');
  });
});

describe('readDashboard', () => {
  it('lädt die eingeschalteten Kacheln mit ihren Optionen', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'withOptions', options: { rows: 3 } }, { module: 'test', key: 'alpha' }] });
    const res = await readDashboard(deps, ctx);
    expect(res.ok && res.value).toEqual([
      { module: 'test', key: 'withOptions', kind: 'list', options: { rows: 3, onlyMine: false }, content: { kind: 'list', lines: [], total: 3, href: null }, error: false },
      { module: 'test', key: 'alpha', kind: 'count', options: {}, content: { kind: 'count', count: 1, href: '/alpha' }, error: false },
    ]);
  });

  it('lässt eine werfende Kachel als Fehler stehen und liefert die anderen', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'broken' }, { module: 'test', key: 'alpha' }] });
    const res = await readDashboard(deps, ctx);
    expect(res.ok && res.value.map((t) => [t.key, t.error, t.content])).toEqual([['broken', true, null], ['alpha', false, { kind: 'count', count: 1, href: '/alpha' }]]);
  });
});
