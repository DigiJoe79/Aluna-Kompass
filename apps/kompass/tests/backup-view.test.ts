import type { BackupManifest, BackupOverview, BackupProblem, BackupRetention } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { backupHeadline, retentionMessage, ringHint, rowActions, toBackupRow, uploadEta, visibleBackups, type BackupRow } from '@/lib/backup-view';
import { formatSize } from '@/lib/format-size';

const TZ = 'Europe/Berlin';
const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;
const T = '2026-10-20T01:00:00.000Z';

const manifest: BackupManifest = {
  format: 3,
  appVersion: '0.3.2',
  createdAt: T,
  environment: 'test',
  migrationCount: 11,
  counts: { users: 4, auditEntries: 900, mediaAssets: 30, records: { 'dms.documents': 12 } },
  files: [],
};
type Item = BackupOverview['items'][number];
const item: Item = {
  version: 1,
  name: 'kompass-backup-test-20261020-010000-automatic',
  kind: 'automatic',
  createdAt: T,
  sizeBytes: 641 * MB,
  sha256: null,
  manifest,
  verification: { status: 'passed', at: T },
  pinned: false,
  pinnedLabel: null,
  hasSidecar: true,
  restorable: true,
  retention: { kind: 'until', until: '2026-10-26', tier: 'daily' } as BackupRetention,
};

const row = (name: string, kind: BackupRow['kind'], createdAt: string, patch: Partial<BackupRow> = {}): BackupRow => ({
  ...toBackupRow({ ...item, name, kind, createdAt }),
  ...patch,
});

const ok = row('ok', 'automatic', T);
const CTX = { running: false, pinnedCount: 0, pinnedMax: 3, newestVerifiedName: 'anderes', canImport: true, canAudit: true, appMigrationCount: 11 };
const problem = (code: BackupProblem['code']): BackupProblem => ({ code, at: T, kind: 'automatic', name: null, reason: null, mailed: false });

describe('toBackupRow', () => {
  it('trägt keine Dateiliste in den Client', () => {
    const r = toBackupRow({ ...item, manifest: { ...manifest, files: Array.from({ length: 2000 }, (_, i) => ({ path: `data/m/${i}.jpg`, size: 1 })) } });
    expect(Object.keys(r)).not.toContain('files');
    expect(Object.keys(r)).not.toContain('manifest');
    expect(JSON.stringify(r).length).toBeLessThan(2048);
    expect(r).toMatchObject({ appVersion: manifest.appVersion, migrationCount: manifest.migrationCount, dropsWhenUnpinned: false });
  });
  it('ohne Manifest: Version, Migrationen und Zählungen leer', () => {
    expect(toBackupRow({ ...item, manifest: null })).toMatchObject({ appVersion: null, migrationCount: null, counts: null });
  });
});

describe('visibleBackups', () => {
  it('zeigt die letzten 7 Tage, alles von Hand und alles Festgehaltene; zählt den Rest nach Stand', () => {
    const rows = [
      row('heute', 'automatic', '2026-10-23T01:00:00Z'),
      row('hand-alt', 'manual', '2026-09-01T10:00:00Z'),
      row('fest', 'manual', '2025-12-31T17:20:00Z', { pinned: true }),
      row('woche', 'automatic', '2026-10-11T01:00:00Z', { retention: { kind: 'until', until: '2026-11-15', tier: 'weekly' } as BackupRetention }),
      row('monat', 'automatic', '2026-10-01T01:00:00Z', { retention: { kind: 'until', until: '2027-09-30', tier: 'monthly' } as BackupRetention }),
      row('upd', 'preUpdate', '2026-10-02T19:40:00Z'),
    ];
    const v = visibleBackups(rows, { today: '2026-10-23', timeZone: TZ, showAll: false });
    expect(v.shown.map((r) => r.name)).toEqual(['heute', 'hand-alt', 'fest']);
    expect(v.hidden).toEqual({ weekly: 1, monthly: 1, other: 1 });
    expect(v.total).toBe(6);
    expect(visibleBackups(rows, { today: '2026-10-23', timeZone: TZ, showAll: true }).shown).toHaveLength(6);
  });
  it('die Grenze ist der Vereinstag: der 17. zählt am 23. noch dazu, der 16. nicht', () => {
    const rows = [row('d17', 'automatic', '2026-10-16T22:30:00Z'), row('d16', 'automatic', '2026-10-16T21:30:00Z')];
    expect(visibleBackups(rows, { today: '2026-10-23', timeZone: TZ, showAll: false }).shown.map((r) => r.name)).toEqual(['d17']);
  });
});

describe('backupHeadline', () => {
  it.each([
    [null, false, false, 'ok', 'ok', null],
    [problem('createFailed'), true, false, 'warn', 'lastVerified', 'failed'],
    [null, true, false, 'warn', 'lastVerified', 'nightlyMissing'],
    [null, true, true, 'warn', 'lastVerified', null],
    [problem('pruneFailed'), false, false, 'ok', 'ok', 'failed'],
  ] as const)('Fall %#', (lastError, nightlyMissing, running, tone, sentence, notice) => {
    const h = backupHeadline({ rows: [ok], lastError, nightlyMissing, running });
    expect(h).toMatchObject({ tone, sentence, notice });
    expect(h.lastVerified?.name).toBe('ok');
  });
  it('ohne geprüftes Backup: warn und sentence none', () => {
    const unverified = row('u', 'manual', T, { verification: { status: 'unverified' } });
    expect(backupHeadline({ rows: [unverified], lastError: null, nightlyMissing: false, running: false })).toEqual({ tone: 'warn', sentence: 'none', lastVerified: null, notice: null });
  });
});

describe('retentionMessage', () => {
  it.each([
    [{ kind: 'until', until: '2026-10-30', tier: 'daily' }, 'automatic', 'until'],
    [{ kind: 'until', until: '2026-11-15', tier: 'weekly' }, 'automatic', 'weekly'],
    [{ kind: 'until', until: '2027-09-30', tier: 'monthly' }, 'automatic', 'monthly'],
    [{ kind: 'until', until: '2026-11-22', tier: 'age' }, 'upload', 'until'],
    [{ kind: 'untilNewer', notBefore: '2026-11-19' }, 'preUpdate', 'untilNewer'],
    [{ kind: 'pinned' }, 'manual', 'pinned'],
    [{ kind: 'prune' }, 'automatic', 'prune'],
  ] as const)('Fall %#', (retention, kind, key) => {
    expect(retentionMessage(retention as BackupRetention, kind).key).toBe(key);
  });
  it('trägt Tag und Art mit', () => {
    expect(retentionMessage({ kind: 'until', until: '2026-11-15', tier: 'weekly' } as BackupRetention, 'automatic')).toEqual({ key: 'weekly', until: '2026-11-15' });
    expect(retentionMessage({ kind: 'untilNewer', notBefore: '2026-11-19' } as BackupRetention, 'preRestore')).toEqual({ key: 'untilNewer', kind: 'preRestore' });
  });
});

describe('rowActions', () => {
  const a = (r: BackupRow, c = {}) => Object.fromEntries(rowActions(r, { ...CTX, ...c }).map((x) => [x.action, x]));
  it('Sperrgründe und ausgeblendete Einträge', () => {
    expect(a(row('f', 'automatic', T, { verification: { status: 'failed', at: T, reason: 'backupCorrupt' }, restorable: false })).restore!.disabledReason).toBe('failed');
    expect(a(ok, { running: true }).restore!.disabledReason).toBe('running');
    expect(a({ ...ok, migrationCount: 12, restorable: false }).restore!.disabledReason).toBe('newer');
    expect(a({ ...ok, migrationCount: null, verification: { status: 'unverified' }, restorable: false }).restore!.disabledReason).toBe('unverified');
    expect(a(ok, { pinnedCount: 3 }).pin!.disabledReason).toBe('pinLimit');
    expect(a(ok, { newestVerifiedName: ok.name }).delete!.disabledReason).toBe('lastVerified');
    expect(a(ok, { canImport: false }).restore!.hidden && a(ok, { canImport: false }).delete!.hidden).toBe(true);
    expect(a({ ...ok, pinned: true }).pin!.hidden && !a({ ...ok, pinned: true }).rename!.hidden && !a({ ...ok, pinned: true }).unpin!.hidden).toBe(true);
    expect(a(ok).rename!.hidden && a(ok).unpin!.hidden).toBe(true);
    expect(a(ok, { canAudit: false }).audit!.hidden).toBe(true);
    expect(a(ok, { running: true }).verify!.disabledReason).toBe('running');
    expect(a(ok).restore!.disabledReason).toBeNull();
  });
  it('Reihenfolge des Designers', () => {
    expect(rowActions(ok, CTX).map((x) => x.action)).toEqual(['restore', 'download', 'pin', 'rename', 'unpin', 'verify', 'audit', 'delete']);
  });
});

describe('uploadEta', () => {
  it('rechnet aus der bisherigen Rate, nicht vor 3 s', () => {
    expect(uploadEta(100, 1000, 2000)).toBeNull();
    expect(uploadEta(0, 1000, 10_000)).toBeNull();
    expect(uploadEta(312, 641, 60_000)).toBe(2);
    expect(uploadEta(640, 641, 60_000)).toBe(1);
  });
});

describe('ringHint', () => {
  it('Summe der Ringe und Platz bei bekannter Größe', () => {
    expect(ringHint({ daily: 7, weekly: 4, monthly: 12 }, 641 * MB)).toEqual({ count: 23, totalBytes: 23 * 641 * MB });
    expect(ringHint({ daily: 7, weekly: 0, monthly: 0 }, null)).toEqual({ count: 7, totalBytes: null });
  });
});

describe('formatSize', () => {
  it('MB ganz, GB und TB mit einer Stelle und Komma', () => {
    expect(formatSize(641 * MB)).toBe('641 MB');
    expect(formatSize(9.8 * GB)).toBe('9,8 GB');
    expect(formatSize(1.2 * TB)).toBe('1,2 TB');
  });
});
