import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { CORE_DASHBOARD_TILES } from '../src/dashboard/tiles';
import type { DashboardTile } from '../src/dashboard/types';
import { users } from '../src/db/schema';
import { createFollowUp } from '../src/follow-ups/service';
import { defineModule } from '../src/modules/manifest';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, ctxWith, insertRole, insertUser, systemContext, TEST_NOW } from '../src/testing';
import { userNamesFor } from '../src/users/names';

const tile = (key: string): DashboardTile => {
  const found = CORE_DASHBOARD_TILES.find((t) => t.key === key);
  if (!found) throw new Error(`keine Kachel ${key}`);
  return found;
};
const options = (t: DashboardTile, overrides: Record<string, unknown> = {}) => ({ ...(t.options.parse({}) as Record<string, unknown>), ...overrides });

function setup() {
  const deps = createTestDeps({ now: '2026-09-17T08:00:00.000Z' });
  const userId = insertUser(deps, { name: 'Anna Berger' });
  return { deps, userId, ctx: ctxWith([...coreModule.permissions], userId) };
}

const setSetting = (deps: ReturnType<typeof setup>['deps'], key: string, value: unknown) =>
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value, 'test'));

describe('core tiles are registered and declare their form', () => {
  it('führt die sechs Kacheln am Kern-Manifest', () => {
    expect(coreModule.dashboardTiles?.map((t) => `${t.key}:${t.kind}:${t.permission}:${t.defaultOn}`)).toEqual([
      'followUps:list:followUps.view:true',
      'setup:list:settings.manage:true',
      'backup:status:backup.export:true',
      'accounts:count:users.manage:false',
      'retention:count:retention.view:true',
      'translations:count:settings.manage:false',
    ]);
  });

  it('jede Kachel liefert die deklarierte Form', async () => {
    const { deps, ctx } = setup();
    for (const t of CORE_DASHBOARD_TILES) {
      const content = await t.load(deps, ctx, options(t));
      expect(content.kind, t.key).toBe(t.kind);
    }
  });
});

describe('followUps tile', () => {
  it('zeigt offene Wiedervorlagen bis zum Horizont, überfällige markiert, mit Zuständiger und Aktion', async () => {
    const { deps, ctx, userId } = setup();
    const manage = ctxWith(['followUps.manage'], userId);
    await createFollowUp(deps, manage, { entityType: 'x', entityId: '1', dueAt: '2026-09-10', title: 'Überfällig', assigneeUserId: userId });
    await createFollowUp(deps, manage, { entityType: 'x', entityId: '2', dueAt: '2026-09-20', title: 'Bald' });
    await createFollowUp(deps, manage, { entityType: 'x', entityId: '3', dueAt: '2026-10-30', title: 'Weit weg' });
    const t = tile('followUps');
    const content = await t.load(deps, ctx, options(t));
    expect(content.kind === 'list' && content.lines.map((l) => [l.title, l.overdue, l.extra, l.action?.kind])).toEqual([
      ['Überfällig', true, 'Anna Berger', 'completeFollowUp'],
      ['Bald', false, undefined, 'completeFollowUp'],
    ]);
    expect(content.kind === 'list' && content.total).toBe(2);
  });

  it('Horizont 30 nimmt die dritte dazu, „nur meine“ lässt die ohne Zuständige weg', async () => {
    const { deps, ctx, userId } = setup();
    const manage = ctxWith(['followUps.manage'], userId);
    await createFollowUp(deps, manage, { entityType: 'x', entityId: '1', dueAt: '2026-09-20', title: 'Meine', assigneeUserId: userId });
    await createFollowUp(deps, manage, { entityType: 'x', entityId: '2', dueAt: '2026-10-10', title: 'Alle' });
    const t = tile('followUps');
    const wide = await t.load(deps, ctx, options(t, { horizonDays: '30' }));
    expect(wide.kind === 'list' && wide.total).toBe(2);
    const mine = await t.load(deps, ctx, options(t, { horizonDays: '30', onlyMine: true }));
    expect(mine.kind === 'list' && mine.lines.map((l) => l.title)).toEqual(['Meine']);
  });

  it('ist ohne Wiedervorlagen leer', async () => {
    const { deps, ctx } = setup();
    const t = tile('followUps');
    expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'list', lines: [], total: 0, href: null });
  });
});

describe('setup tile', () => {
  it('nennt jedes leere Pflichtfeld, die fehlende zweite Rolle und das fehlende Fachmodul', async () => {
    const finance = defineModule({ key: 'finance', version: '0', permissions: ['finance.view'] });
    const deps = createTestDeps({ manifests: [coreModule, finance] });
    const ctx = ctxWith(['settings.manage'], insertUser(deps, {}));
    insertRole(deps, { name: 'Administration', isProtected: true });
    const t = tile('setup');
    const content = await t.load(deps, ctx, options(t));
    expect(content.kind === 'list' && content.lines.map((l) => l.titleKey)).toEqual([
      'settingStreet', 'settingPostalCode', 'settingCity', 'settingRegisterCourt', 'settingRegisterNumber',
      'settingTaxNumber', 'settingTaxOffice', 'settingExemptionNoticeType', 'settingExemptionNoticeDate',
      'noRole', 'noModule',
    ]);
    expect(content.kind === 'list' && content.lines.map((l) => l.href)).toEqual([
      ...Array(9).fill('/admin/settings'), '/admin/roles', '/admin/modules',
    ]);
  });

  it('ist leer, wenn alles gefüllt ist', async () => {
    const { deps, ctx } = setup();
    for (const [key, value] of Object.entries({ 'organization.street': 'S', 'organization.postalCode': '1', 'organization.city': 'C', 'organization.registerCourt': 'R', 'organization.registerNumber': 'N', 'organization.taxNumber': 'T', 'organization.taxOffice': 'O', 'organization.exemptionNoticeType': 'section60a', 'organization.exemptionNoticeDate': '2026-01-01' })) setSetting(deps, key, value);
    insertRole(deps, { name: 'Schatzmeisterin' });
    const t = tile('setup');
    const content = await t.load(deps, ctx, options(t));
    expect(content.kind === 'list' && content.lines.filter((l) => l.titleKey !== 'noModule')).toEqual([]);
  });

  it('nennt kein fehlendes Modul, wenn keins installiert ist', async () => {
    const { deps, ctx } = setup();
    const t = tile('setup');
    const content = await t.load(deps, ctx, options(t));
    expect(content.kind === 'list' && content.lines.some((l) => l.titleKey === 'noModule')).toBe(false);
  });
});

describe('backup tile', () => {
  it('warnt ohne Export, warnt bei Export älter als die Frist, ist sonst neutral', async () => {
    const { deps, ctx } = setup();
    const t = tile('backup');
    expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'warning', messageKey: 'never', href: '/admin/backup' });
    setSetting(deps, 'system.lastExportAt', '2026-09-14T08:00:00.000Z');
    expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'neutral', messageKey: 'recent', values: { days: 3 }, href: '/admin/backup' });
    setSetting(deps, 'backup.maxAgeDays', 2);
    expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'warning', messageKey: 'stale', values: { days: 3 }, href: '/admin/backup' });
  });
});

describe('accounts tile', () => {
  it('zählt aktive Konten mit Startpasswort oder laufender Sperre', async () => {
    const { deps, ctx } = setup();
    const fresh = insertUser(deps, { name: 'Neu' });
    deps.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, fresh)).run();
    const locked = insertUser(deps, { name: 'Gesperrt' });
    deps.db.update(users).set({ lockedUntil: '2026-09-17T09:00:00.000Z' }).where(eq(users.id, locked)).run();
    const expired = insertUser(deps, { name: 'Frei' });
    deps.db.update(users).set({ lockedUntil: '2026-09-17T07:00:00.000Z' }).where(eq(users.id, expired)).run();
    const inactive = insertUser(deps, { name: 'Weg', isActive: false });
    deps.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, inactive)).run();
    const t = tile('accounts');
    expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'count', count: 2, href: '/admin/users' });
  });
});

describe('retention and translations tiles', () => {
  it('zählen, was der Kern sammelt', async () => {
    const { deps, ctx } = setup();
    expect(await tile('retention').load(deps, ctx, {})).toEqual({ kind: 'count', count: 0, href: '/admin/retention' });
    expect(await tile('translations').load(deps, ctx, {})).toEqual({ kind: 'count', count: 0, href: '/admin/locales' });
  });
});

describe('userNamesFor', () => {
  it('liest Namen zu IDs ohne Rechteprüfung, leer für leere Liste', () => {
    const { deps, userId } = setup();
    expect(userNamesFor(deps, [])).toEqual(new Map());
    expect(userNamesFor(deps, [userId, userId, 'NOBODY'])).toEqual(new Map([[userId, 'Anna Berger']]));
  });
});
