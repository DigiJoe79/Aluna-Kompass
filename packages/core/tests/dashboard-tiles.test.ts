import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { coreModule } from '../src/core-module';
import { writeSidecar } from '../src/backup/sidecar';
import { updateBackupState } from '../src/backup/state';
import { CORE_DASHBOARD_TILES } from '../src/dashboard/tiles';
import type { DashboardTile } from '../src/dashboard/types';
import * as schema from '../src/db/schema';
import { users } from '../src/db/schema';
import { createFollowUp } from '../src/follow-ups/service';
import { messageDateTime } from '../src/message-date';
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
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value));

describe('core tiles are registered and declare their form', () => {
  // Schlüssel, Art und Recht jeder Kachel prüft `defineModule` beim Laden; welche Kacheln es gibt, pinnt kein Test.
  it('Fällig ist die Art `due`, Backup trägt bei einer Warnung einen Knopf (Briefing Startseite § 4)', () => {
    expect(coreModule.dashboardTiles?.filter((t) => t.variant).map((t) => `${t.key}:${t.variant}`)).toEqual(['followUps:due']);
    expect(coreModule.dashboardTiles?.filter((t) => t.warningAction).map((t) => t.key)).toEqual(['backup']);
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

  it('setup tile names an open install error', async () => {
    const deps = createTestDeps();
    deps.db.insert(schema.moduleProvisionErrors).values({ id: 'E1', module: 'demo', message: 'kaputt', at: TEST_NOW, resolvedAt: null }).run();
    const tile = CORE_DASHBOARD_TILES.find((t) => t.key === 'setup')!;
    const content = await tile.load(deps, ctxWith(['settings.manage']), {});
    expect(content.kind === 'list' && content.lines.some((l) => l.titleKey === 'installError' && l.values?.module === 'demo')).toBe(true);
  });
});

describe('backup tile', () => {
  const sidecar = (bp: string, name: string, createdAt: string, status: 'passed' | 'failed') => {
    writeFileSync(path.join(bp, `${name}.tar`), 'x');
    writeSidecar(bp, {
      version: 1,
      name,
      kind: 'manual',
      createdAt,
      sizeBytes: 1,
      sha256: null,
      manifest: null,
      verification: status === 'passed' ? { status, at: createdAt } : { status, at: createdAt, reason: 'backupCorrupt' },
      pinned: false,
      pinnedLabel: null,
    });
  };

  it('liest das neueste geprüfte Backup aus dem Verzeichnis: ohne → never, älter als die Frist → stale, gescheitertes zählt nicht', async () => {
    const t = tile('backup');
    const without = createTestDeps({ now: '2026-09-17T08:00:00.000Z' });
    expect(await t.load(without, ctxWith(['backup.export']), options(t))).toEqual({ kind: 'status', tone: 'warning', messageKey: 'never', values: { schedule: 'off' }, href: '/admin/backup' });
    const bp = mkdtempSync(path.join(tmpdir(), 'kompass-tile-'));
    try {
      const deps = createTestDeps({ now: '2026-09-17T08:00:00.000Z', backupPath: bp });
      const ctx = ctxWith(['backup.export']);
      expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'warning', messageKey: 'never', values: { schedule: 'off' }, href: '/admin/backup' });
      sidecar(bp, 'alt', '2026-08-08T08:00:00.000Z', 'passed');
      sidecar(bp, 'kaputt', '2026-09-16T08:00:00.000Z', 'failed');
      expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'warning', messageKey: 'stale', values: { days: 40, schedule: 'off' }, href: '/admin/backup' });
      sidecar(bp, 'gut', '2026-09-14T08:00:00.000Z', 'passed');
      expect(await t.load(deps, ctx, options(t))).toEqual({ kind: 'status', tone: 'neutral', messageKey: 'recent', values: { when: messageDateTime(deps, '2026-09-14T08:00:00.000Z') }, href: '/admin/backup' });
      // Zeitplan an, die Uhrzeit noch nicht erreicht: kein „fehlt“, die Kachel sagt nur nicht „aus“.
      deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true));
      deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.time', '23:00'));
      rmSync(path.join(bp, 'gut.tar'));
      expect(await t.load(deps, ctx, options(t))).toMatchObject({ messageKey: 'stale', values: { days: 40, schedule: 'on' } });
    } finally {
      rmSync(bp, { recursive: true, force: true });
    }
  });
});

describe('backup tile — Warnungen', () => {
  const passed = (bp: string, name: string, createdAt: string, kind: 'manual' | 'automatic' = 'manual', size = 1) => {
    writeFileSync(path.join(bp, `${name}.tar`), Buffer.alloc(size));
    writeSidecar(bp, { version: 1, name, kind, createdAt, sizeBytes: size, sha256: null, manifest: null, verification: { status: 'passed', at: createdAt }, pinned: false, pinnedLabel: null });
  };
  const warning = (messageKey: string) => ({ kind: 'status', tone: 'warning', messageKey, href: '/admin/backup' });

  it('Vorrang failed > notMounted > nightlyMissing > storageLow > recent', async () => {
    const t = tile('backup');
    const bp = mkdtempSync(path.join(tmpdir(), 'kompass-tile-'));
    try {
      // 2026-10-23 10:00 UTC = 12:00 Berlin; ein Von Hand von heute 02:30, vor der Uhrzeit des Zeitplans
      const deps = createTestDeps({ now: '2026-10-23T10:00:00.000Z', backupPath: bp });
      const ctx = ctxWith(['backup.export']);
      passed(bp, 'heute', '2026-10-23T00:30:00.000Z');
      expect(await t.load(deps, ctx, options(t))).toMatchObject({ tone: 'neutral', messageKey: 'recent' });
      const spy = vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 1, bsize: 1, blocks: 100 } as fs.StatsFs);
      vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 1, blocks: 100 } as fs.StatsFs);
      expect(await t.load(deps, ctx, options(t))).toEqual(warning('storageLow'));
      deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true));
      expect(await t.load(deps, ctx, options(t))).toEqual({ ...warning('nightlyMissing'), values: { when: messageDateTime(deps, '2026-10-23T00:30:00.000Z') } });
      deps.backupMountWarning = 'notMounted';
      expect(await t.load(deps, ctx, options(t))).toEqual(warning('notMounted'));
      updateBackupState(bp, { lastError: { code: 'createFailed', at: '2026-10-23T01:00:00.000Z', kind: 'automatic', name: null, reason: 'writeFailed', mailed: true } });
      expect(await t.load(deps, ctx, options(t))).toEqual({ ...warning('failed'), values: { kind: 'automatic', when: messageDateTime(deps, '2026-10-23T00:30:00.000Z') } });
      spy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      rmSync(bp, { recursive: true, force: true });
    }
  });

  it('ein geprüftes automatisches von heute: keine Warnung nightlyMissing', async () => {
    const t = tile('backup');
    const bp = mkdtempSync(path.join(tmpdir(), 'kompass-tile-'));
    try {
      const deps = createTestDeps({ now: '2026-10-23T10:00:00.000Z', backupPath: bp });
      deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true));
      passed(bp, 'nacht', '2026-10-23T01:00:00.000Z', 'automatic');
      expect(await t.load(deps, ctxWith(['backup.export']), options(t))).toMatchObject({ messageKey: 'recent' });
    } finally {
      rmSync(bp, { recursive: true, force: true });
    }
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
