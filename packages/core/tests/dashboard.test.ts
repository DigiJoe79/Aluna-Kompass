import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule } from '../src/core-module';
import { getDashboardLayout, listDashboardTiles, readDashboard, resetDashboardLayout, setDashboardLayout } from '../src/dashboard/service';
import type { DashboardLine, DashboardTile } from '../src/dashboard/types';
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

/** Ein Modul mit Kacheln: eine an, eine aus, eine mit Optionen, eine, die wirft, eine Warnung mit Knopf und eine Arbeit. */
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
  permissions: ['test.view', 'test.manage', 'test.work'],
  dashboardTiles: [
    counter('alpha', true, 1),
    counter('beta', false, 2),
    withOptionsTile as DashboardTile,
    { key: 'broken', permission: 'test.view', kind: 'status', defaultOn: false, options: z.object({}), load: () => { throw new Error('kaputt'); } },
    { key: 'gamma', permission: 'test.view', kind: 'status', defaultOn: false, warningAction: true, options: z.object({}), load: () => ({ kind: 'status', tone: 'warning', messageKey: 'x', href: '/gamma' }) },
    { key: 'work', permission: 'test.work', kind: 'list', variant: 'work', defaultOn: true, options: z.object({}), load: () => ({ kind: 'list', lines: [], total: 0, href: null }) },
  ],
});

function setup(permissions: string[] = ['test.view', 'test.manage']) {
  const deps = createTestDeps({ manifests: [coreModule, testModule] });
  deps.db.insert(schemaSettings).values({ key: 'modules.enabled', value: JSON.stringify(['test']), updatedAt: TEST_NOW }).run();
  const userId = insertUser(deps, { name: 'Anna' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}

/** Kurzform: eine Anordnung als Schlüssel je Spalte. */
const keys = (columns: { key: string }[][]) => columns.map((c) => c.map((t) => t.key));
const tileRef = (key: string, options: Record<string, unknown> = {}) => ({ module: 'test', key, options });
const storedRow = (deps: ReturnType<typeof setup>['deps'], userId: string) => JSON.parse(deps.db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).get()!.tiles) as unknown;

describe('listDashboardTiles', () => {
  it('nennt nur Kacheln, für die der Nutzer das Recht hat, mit Optionsfeldern', async () => {
    const { deps } = setup(['test.view']);
    const res = await listDashboardTiles(deps, ctxWith(['test.view'], 'U'));
    expect(res.ok && res.value.map((t) => `${t.module}.${t.key}`)).toEqual(['test.alpha', 'test.beta', 'test.broken', 'test.gamma']);
  });

  it('liefert die Optionsfelder und die Art der Kachel', async () => {
    const { deps, ctx } = setup(['test.view', 'test.manage', 'test.work']);
    const res = await listDashboardTiles(deps, ctx);
    const withOptions = res.ok ? res.value.find((t) => t.key === 'withOptions') : undefined;
    expect(withOptions).toMatchObject({ kind: 'list', variant: null, defaultOn: true, options: [{ name: 'rows', type: 'integer', min: 0, max: 10, default: 5 }, { name: 'onlyMine', type: 'boolean', default: false }] });
    expect(res.ok && res.value.find((t) => t.key === 'work')?.variant).toBe('work');
  });

  it('weist ohne Sitzung ab', async () => {
    const { deps } = setup();
    const res = await listDashboardTiles(deps, ctxWith(['test.view'], null));
    expect(res.ok).toBe(false);
  });
});

describe('getDashboardLayout: Vorgabe ohne gespeicherte Anordnung', () => {
  it('gibt ohne Arbeit-Kachel drei gleiche Spalten: Listen in Spalte 1, Zahl und Warnung in 2 und 3, mit Optionsvorgaben', async () => {
    const { deps, ctx } = setup();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value).toEqual({
      layout: 'thirds',
      custom: false,
      columns: [[tileRef('withOptions', { rows: 5, onlyMine: false })], [tileRef('alpha')], []],
      arrangements: {
        thirds: [[tileRef('withOptions', { rows: 5, onlyMine: false })], [tileRef('alpha')], []],
        'wide-narrow': [[tileRef('withOptions', { rows: 5, onlyMine: false }), tileRef('alpha')], []],
      },
    });
  });

  it('gibt 2:1, wer eine Arbeit-Kachel sehen darf (Finanzen: zu tun) — Listen breit, Zahl schmal', async () => {
    const { deps, ctx } = setup(['test.view', 'test.manage', 'test.work']);
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value.layout).toBe('wide-narrow');
    expect(res.ok && keys(res.value.columns)).toEqual([['withOptions', 'work'], ['alpha']]);
    expect(res.ok && keys(res.value.arrangements.thirds)).toEqual([['withOptions'], ['work'], ['alpha']]);
  });

  it('lässt in der Vorgabe Kacheln ohne Recht weg', async () => {
    const { deps } = setup();
    const res = await getDashboardLayout(deps, ctxWith(['test.view'], 'U'));
    expect(res.ok && keys(res.value.columns)).toEqual([['alpha'], [], []]);
  });
});

describe('getDashboardLayout: alte gespeicherte Anordnung (flache Liste bis 0.2.11)', () => {
  const legacy = [tileRef('beta'), tileRef('withOptions', { rows: 3 }), tileRef('alpha')];

  it('liest sie als Spalten des Vorgabe-Layouts, nach Reihenfolge ausgeglichen — ohne Verlust, Ausgeschaltetes bleibt aus', async () => {
    const { deps, ctx, userId } = setup();
    deps.db.insert(dashboardLayouts).values({ userId, tiles: JSON.stringify(legacy), updatedAt: TEST_NOW }).run();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value.custom).toBe(true);
    expect(res.ok && res.value.layout).toBe('thirds');
    expect(res.ok && keys(res.value.columns)).toEqual([['beta'], ['withOptions'], ['alpha']]);
    expect(res.ok && res.value.columns[1]![0]!.options).toEqual({ rows: 3, onlyMine: false });
    expect(res.ok && keys(res.value.arrangements['wide-narrow'])).toEqual([['beta', 'withOptions'], ['alpha']]);
  });

  it('leitet für 2:1 aus den drei Spalten ab', async () => {
    const { deps, ctx, userId } = setup(['test.view', 'test.manage', 'test.work']);
    deps.db.insert(dashboardLayouts).values({ userId, tiles: JSON.stringify(legacy), updatedAt: TEST_NOW }).run();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value.layout).toBe('wide-narrow');
    expect(res.ok && keys(res.value.columns)).toEqual([['beta', 'withOptions'], ['alpha']]);
  });

  it('fällt bei einer gespeicherten Option, die das Schema nicht mehr kennt, auf die Vorgabe zurück', async () => {
    const { deps, ctx, userId } = setup();
    deps.db.insert(dashboardLayouts).values({ userId, tiles: JSON.stringify([tileRef('withOptions', { rows: 'viele', onlyMine: true })]), updatedAt: TEST_NOW }).run();
    const res = await getDashboardLayout(deps, ctx);
    expect(res.ok && res.value.columns.flat()[0]?.options).toEqual({ rows: 5, onlyMine: true });
  });
});

describe('setDashboardLayout mit Layout und Spalten', () => {
  it('speichert die Spalten für dieses Layout, lässt das andere, wie es war, und protokolliert Vorher/Nachher', async () => {
    const { deps, ctx, userId } = setup();
    const saved = await setDashboardLayout(deps, ctx, { layout: 'thirds', columns: [[{ module: 'test', key: 'alpha' }], [{ module: 'test', key: 'withOptions', options: { rows: 10 } }], [{ module: 'test', key: 'beta' }]] });
    expect(saved.ok && saved.value.custom).toBe(true);
    expect(saved.ok && saved.value.columns).toEqual([[tileRef('alpha')], [tileRef('withOptions', { rows: 10, onlyMine: false })], [tileRef('beta')]]);
    // Das andere Layout war die Ableitung der Vorgabe und bleibt es; nur das eingeschaltete `beta` kommt in die kürzeste Spalte.
    expect(saved.ok && keys(saved.value.arrangements['wide-narrow'])).toEqual([['withOptions', 'alpha'], ['beta']]);
    const read = await getDashboardLayout(deps, ctx);
    expect(read.ok && read.value).toEqual(saved.ok && saved.value);
    expect(storedRow(deps, userId)).toMatchObject({ v: 2, layout: 'thirds' });
    const entry = auditEntry(deps, 'dashboard.setLayout');
    expect(entry.entityType).toBe('dashboardLayout');
    expect(entry.entityId).toBe(userId);
    expect(JSON.parse(entry.before!)).toBeNull();
    expect(JSON.parse(entry.after!)).toMatchObject({ v: 2, layout: 'thirds' });
    expect(JSON.parse(entry.params!)).toEqual({ tileCount: 3 });
  });

  it('wechselt das Layout und zurück — jedes behält seine eigene Anordnung', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { layout: 'thirds', columns: [[{ module: 'test', key: 'alpha' }], [{ module: 'test', key: 'withOptions' }], [{ module: 'test', key: 'beta' }]] });
    // Erster Wechsel ohne Spalten: die Anordnung von 2:1, wie sie war.
    const wide = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow' });
    expect(wide.ok && wide.value.layout).toBe('wide-narrow');
    expect(wide.ok && keys(wide.value.columns)).toEqual([['withOptions', 'alpha'], ['beta']]);
    await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'test', key: 'withOptions' }], [{ module: 'test', key: 'alpha' }, { module: 'test', key: 'broken' }]] });
    const back = await setDashboardLayout(deps, ctx, { layout: 'thirds' });
    // Die Anordnung bleibt; ein- und ausgeschaltet gilt für beide (Vorgaben Teil M, Entscheidung 1): `beta` ist aus,
    // `broken` kam ans Ende der kürzesten Spalte.
    expect(back.ok && keys(back.value.columns)).toEqual([['alpha'], ['withOptions'], ['broken']]);
    const again = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow' });
    expect(again.ok && keys(again.value.columns)).toEqual([['withOptions'], ['alpha', 'broken']]);
  });

  it('schaltet ein und aus für beide Layouts gemeinsam — aus fällt überall weg, ein kommt ans Ende der kürzesten Spalte', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { layout: 'thirds', columns: [[tileRef('withOptions')], [tileRef('alpha')], [tileRef('beta')]] });
    await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[tileRef('withOptions'), tileRef('alpha')], [tileRef('beta')]] });
    // In 2:1 `alpha` aus und `gamma` ein.
    const saved = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[tileRef('withOptions'), tileRef('gamma')], [tileRef('beta')]] });
    expect(saved.ok && keys(saved.value.columns)).toEqual([['withOptions', 'gamma'], ['beta']]);
    // In drei Spalten fehlt `alpha`; `gamma` steht unten in der kürzesten (Spalte 2 ist leer, Länge 0).
    expect(saved.ok && keys(saved.value.arrangements.thirds)).toEqual([['withOptions'], ['gamma'], ['beta']]);
    const back = await setDashboardLayout(deps, ctx, { layout: 'thirds' });
    expect(back.ok && keys(back.value.columns)).toEqual([['withOptions'], ['gamma'], ['beta']]);
  });

  it('leitet beim ersten Wechsel einer alten Anordnung nach der Regel ab', async () => {
    const { deps, ctx, userId } = setup();
    deps.db.insert(dashboardLayouts).values({ userId, tiles: JSON.stringify([tileRef('alpha'), tileRef('withOptions'), tileRef('beta')]), updatedAt: TEST_NOW }).run();
    const wide = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow' });
    expect(wide.ok && keys(wide.value.columns)).toEqual([['alpha', 'withOptions'], ['beta']]);
  });

  it('lehnt eine falsche Spaltenzahl, eine unbekannte, eine fremde und eine doppelte Kachel mit Pfad ab', async () => {
    const { deps } = setup();
    const ctx = ctxWith(['test.view'], insertUser(deps, {}));
    const count = await setDashboardLayout(deps, ctx, { layout: 'thirds', columns: [[{ module: 'test', key: 'alpha' }]] });
    expect(count.ok === false && count.error.type === 'validation' && count.error.issues[0]).toMatchObject({ path: 'columns', message: 'columnCount' });
    const unknown = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[], [{ module: 'test', key: 'nope' }]] });
    expect(unknown.ok === false && unknown.error.type === 'validation' && unknown.error.issues[0]).toMatchObject({ path: 'columns.1.0', message: 'unknownTile' });
    const foreign = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'test', key: 'withOptions' }], []] });
    expect(foreign.ok === false && foreign.error.type === 'validation' && foreign.error.issues[0]).toMatchObject({ path: 'columns.0.0', message: 'forbiddenTile' });
    const twice = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'test', key: 'alpha' }], [{ module: 'test', key: 'alpha' }]] });
    expect(twice.ok === false && twice.error.type === 'validation' && twice.error.issues[0]).toMatchObject({ path: 'columns.1.0', message: 'duplicateTile' });
  });

  it('lehnt Optionen außerhalb des Schemas ab', async () => {
    const { deps, ctx } = setup();
    const res = await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'test', key: 'withOptions', options: { rows: 99 } }], []] });
    expect(res.ok === false && res.error.type === 'validation' && res.error.issues[0]?.path).toBe('columns.0.0.options.rows');
  });

  it('verlangt genau eine Form: Layout (mit oder ohne Spalten) oder die flache Liste', async () => {
    const { deps, ctx } = setup();
    expect((await setDashboardLayout(deps, ctx, {})).ok).toBe(false);
    expect((await setDashboardLayout(deps, ctx, { layout: 'thirds', tiles: [] })).ok).toBe(false);
    expect((await setDashboardLayout(deps, ctx, { columns: [[], [], []] })).ok).toBe(false);
    expect((await setDashboardLayout(deps, ctx, { layout: 'grid', columns: [] })).ok).toBe(false);
  });
});

describe('setDashboardLayout mit der alten flachen Liste', () => {
  it('verteilt sie auf das aktive Layout und leitet das andere ab', async () => {
    const { deps, ctx, userId } = setup();
    const saved = await setDashboardLayout(deps, ctx, { tiles: [{ module: 'test', key: 'withOptions', options: { rows: 10 } }, { module: 'test', key: 'beta' }, { module: 'test', key: 'alpha' }] });
    expect(saved.ok && saved.value.layout).toBe('thirds');
    expect(saved.ok && keys(saved.value.columns)).toEqual([['withOptions'], ['beta'], ['alpha']]);
    expect(saved.ok && saved.value.columns[0]![0]!.options).toEqual({ rows: 10, onlyMine: false });
    expect(saved.ok && keys(saved.value.arrangements['wide-narrow'])).toEqual([['withOptions', 'beta'], ['alpha']]);
    expect(JSON.parse(auditEntry(deps, 'dashboard.setLayout').params!)).toEqual({ tileCount: 3 });
    expect(storedRow(deps, userId)).toMatchObject({ v: 2 });
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
    expect(off.ok && off.value.columns).toEqual([[], [], []]);
    await setModuleEnabled(deps, admin, { key: 'test', enabled: true });
    const on = await getDashboardLayout(deps, ctx);
    expect(on.ok && keys(on.value.columns)).toEqual([['alpha'], [], []]);
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
    expect(JSON.parse(entry.before!)).toMatchObject({ v: 2, layout: 'thirds', arrangements: { thirds: [[{ module: 'test', key: 'beta', options: {} }], [], []] } });
  });

  it('ist ohne Zeile ein stiller Erfolg ohne Protokolleintrag', async () => {
    const { deps, ctx } = setup();
    const res = await resetDashboardLayout(deps, ctx);
    expect(res.ok).toBe(true);
    expect(deps.db.select().from(auditLog).all().map((e) => e.action)).not.toContain('dashboard.resetLayout');
  });
});

describe('readDashboard', () => {
  it('lädt die Kacheln des aktiven Layouts Spalte für Spalte, mit Spalte, Art und Warn-Knopf', async () => {
    const { deps, ctx } = setup(['test.view', 'test.manage', 'test.work']);
    await setDashboardLayout(deps, ctx, { layout: 'wide-narrow', columns: [[{ module: 'test', key: 'withOptions', options: { rows: 3 } }, { module: 'test', key: 'work' }], [{ module: 'test', key: 'alpha' }, { module: 'test', key: 'gamma' }]] });
    const res = await readDashboard(deps, ctx);
    expect(res.ok && res.value).toEqual([
      { module: 'test', key: 'withOptions', kind: 'list', variant: null, warningAction: false, column: 0, options: { rows: 3, onlyMine: false }, content: { kind: 'list', lines: [], total: 3, href: null }, error: false },
      { module: 'test', key: 'work', kind: 'list', variant: 'work', warningAction: false, column: 0, options: {}, content: { kind: 'list', lines: [], total: 0, href: null }, error: false },
      { module: 'test', key: 'alpha', kind: 'count', variant: null, warningAction: false, column: 1, options: {}, content: { kind: 'count', count: 1, href: '/alpha' }, error: false },
      { module: 'test', key: 'gamma', kind: 'status', variant: null, warningAction: true, column: 1, options: {}, content: { kind: 'status', tone: 'warning', messageKey: 'x', href: '/gamma' }, error: false },
    ]);
  });

  it('lässt eine werfende Kachel als Fehler stehen und liefert die anderen', async () => {
    const { deps, ctx } = setup();
    await setDashboardLayout(deps, ctx, { layout: 'thirds', columns: [[{ module: 'test', key: 'broken' }, { module: 'test', key: 'alpha' }], [], []] });
    const res = await readDashboard(deps, ctx);
    expect(res.ok && res.value.map((t) => [t.key, t.error, t.content])).toEqual([['broken', true, null], ['alpha', false, { kind: 'count', count: 1, href: '/alpha' }]]);
  });
});

describe('tiles that may be absent (Spec Vorschläge § 4)', () => {
  it('leaves out a tile whose available() is false, in the layout and in the choice', async () => {
    let on = false;
    const maybe: DashboardTile = { key: 'maybe', permission: 'test.view', kind: 'count', defaultOn: true, options: z.object({}), available: () => on, load: () => ({ kind: 'count', count: 1, href: null }) };
    const mod = defineModule({ key: 'test', version: '0', permissions: ['test.view'], dashboardTiles: [maybe] });
    const deps = createTestDeps({ manifests: [coreModule, mod] });
    deps.db.insert(schemaSettings).values({ key: 'modules.enabled', value: JSON.stringify(['test']), updatedAt: TEST_NOW }).run();
    const ctx = ctxWith(['test.view'], insertUser(deps, { name: 'Anna' }));
    const keys = async () => {
      const list = await listDashboardTiles(deps, ctx);
      const read = await readDashboard(deps, ctx);
      return [list.ok ? list.value.map((t) => t.key) : [], read.ok ? read.value.map((t) => t.key) : []];
    };
    expect(await keys()).toEqual([[], []]);
    on = true;
    expect(await keys()).toEqual([['maybe'], ['maybe']]);
  });
});

describe('Zusatz rechts in einer Kachelzeile (Designer Stufe 2 Nr. 1, Joe 2026-10-16)', () => {
  it('reicht `trailing` als fertigen Text durch — der Kern kennt keinen Geldbegriff', async () => {
    const line: DashboardLine = { title: 'Zeile', trailing: '12,00 €' };
    const lined = defineModule({
      key: 'lined',
      version: '0',
      permissions: ['lined.view'],
      dashboardTiles: [
        {
          key: 'rows',
          permission: 'lined.view',
          kind: 'list',
          defaultOn: true,
          options: z.object({}),
          load: () => ({ kind: 'list', lines: [line], total: 1, href: null }),
        },
      ],
    });
    const deps = createTestDeps({ manifests: [coreModule, lined] });
    deps.db.insert(schemaSettings).values({ key: 'modules.enabled', value: JSON.stringify(['lined']), updatedAt: TEST_NOW }).run();
    const ctx = ctxWith(['lined.view'], insertUser(deps, { name: 'Anna' }));
    const res = await readDashboard(deps, ctx);
    const tile = res.ok ? res.value.find((t) => t.module === 'lined') : undefined;
    expect(tile?.content).toEqual({ kind: 'list', lines: [{ title: 'Zeile', trailing: '12,00 €' }], total: 1, href: null });
  });
});
