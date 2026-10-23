import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { backupJobSlot } from '../src/backup/jobs';
import {
  backupJobStatus,
  cancelBackupJob,
  deleteBackup,
  listBackupArchives,
  openBackupDownload,
  pinBackup,
  startBackup,
  startBackupVerification,
  unpinBackup,
} from '../src/backup/services';
import { readSidecar, writeSidecar, type BackupListKind, type BackupSidecar } from '../src/backup/sidecar';
import { fixedClock } from '../src/clock';
import { auditLog } from '../src/db/schema';
import { beginJob, endJob, waitForJob } from '../src/jobs';
import { unwrap, type Result } from '../src/result';
import { updateBackupState } from '../src/backup/state';
import { writeSettingInternal } from '../src/settings/service';
import { auditEntry, ctxWith, systemContext } from '../src/testing';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-services-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = '2026-10-23T10:00:00.000Z';
const EXPORT = ['backup.export'];
const ALL = ['backup.export', 'backup.import'];

function setup(withPath = true) {
  const clock = fixedClock(NOW);
  const deps = createDeps({ dataPath: tmp(), ...(withPath ? { backupPath: tmp() } : {}), env: 'test', clock });
  return { deps, clock, bp: deps.backupPath! };
}

const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

/** Ein Backup ohne echtes Archiv: 1000 Bytes und eine Begleitdatei. */
function fake(deps: AppDeps, name: string, opts: { kind?: BackupListKind; createdAt?: string; status?: 'passed' | 'failed' | 'unverified'; pinned?: boolean; migrationCount?: number; sidecar?: boolean } = {}): string {
  const bp = deps.backupPath!;
  writeFileSync(path.join(bp, `${name}.tar`), Buffer.alloc(1000, 7));
  if (opts.sidecar === false) return name;
  const createdAt = opts.createdAt ?? NOW;
  const status = opts.status ?? 'passed';
  const sidecar: BackupSidecar = {
    version: 1,
    name,
    kind: opts.kind ?? 'manual',
    createdAt,
    sizeBytes: 1000,
    sha256: null,
    manifest: {
      format: 3,
      appVersion: '0.3.2',
      createdAt,
      environment: 'test',
      migrationCount: opts.migrationCount ?? deps.migrationCount,
      counts: { users: 1, auditEntries: 0, mediaAssets: 0, records: {} },
      files: [],
    },
    verification: status === 'passed' ? { status, at: createdAt } : status === 'failed' ? { status, at: createdAt, reason: 'backupCorrupt' } : { status },
    pinned: opts.pinned ?? false,
    pinnedLabel: null,
  };
  writeSidecar(bp, sidecar);
  return name;
}

const code = (r: Result<unknown>) => (r.ok ? null : r.error.type === 'conflict' ? r.error.code : r.error.type);
const audits = (deps: AppDeps, action: string) => deps.db.select().from(auditLog).all().filter((e) => e.action === action);

describe('Backup-Dienste', { timeout: 20_000 }, () => {
  it('listet mit restorable=false für ein Backup mit mehr Migrationen und mit retention je Eintrag aus planRetention', async () => {
    const { deps } = setup();
    fake(deps, 'neuer', { migrationCount: deps.migrationCount + 1, createdAt: daysAgo(1) });
    fake(deps, 'gut', { kind: 'preUpdate', createdAt: daysAgo(2) });
    fake(deps, 'kaputt', { kind: 'preUpdate', createdAt: daysAgo(3), status: 'failed' });
    fake(deps, 'fremd', { sidecar: false });
    const overview = unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {}));
    const by = new Map(overview.items.map((i) => [i.name, i]));
    expect(overview.pinnedMax).toBe(3);
    expect(by.get('neuer')).toMatchObject({ restorable: false, retention: { kind: 'untilNextManual' } });
    expect(by.get('gut')).toMatchObject({ restorable: true, retention: { kind: 'untilNewer' } });
    expect(by.get('kaputt')).toMatchObject({ restorable: false, retention: { kind: 'until', tier: 'age' } });
    expect(by.get('fremd')).toMatchObject({ restorable: false, kind: 'unknown', retention: { kind: 'kept' } });
    expect(code(await listBackupArchives(deps, ctxWith([]), {}))).toBe('forbidden');
    deps.close();
  });

  it('listBackupArchives liefert storage, lastError, mountWarning, mailAvailable, schedule und nightlyMissing', async () => {
    const { deps, bp } = setup();
    fake(deps, 'gut', { kind: 'manual', createdAt: daysAgo(1) });
    updateBackupState(bp, { lastError: { code: 'pruneFailed', at: NOW, kind: 'manual', name: 'gut', reason: 'x', mailed: false } });
    let overview = unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {}));
    expect(overview).toMatchObject({
      storage: { usedBytes: 1000, referenceBytes: 1000, freeBytes: expect.any(Number), totalBytes: expect.any(Number), low: expect.any(Boolean) },
      lastError: { code: 'pruneFailed', name: 'gut' },
      mountWarning: null,
      mailAvailable: false,
      schedule: { enabled: false, time: '03:00' },
      nightlyMissing: false,
    });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true));
    overview = unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {}));
    expect(overview).toMatchObject({ schedule: { enabled: true, time: '03:00' }, nightlyMissing: true }); // 12:00 Berlin, kein automatisches
    fake(deps, 'nacht', { kind: 'automatic', createdAt: '2026-10-23T01:00:00.000Z' });
    expect(unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {})).nightlyMissing).toBe(false);
    deps.close();
  });

  // Joe 2026-10-23 auf Test: Die Warnung rät „Erstellen Sie jetzt eines von Hand“ — dann muss es sie auch beenden.
  it('nightlyMissing: ein geprüftes Backup gleich welcher Art nach der Uhrzeit beendet die Warnung, eines davor nicht', async () => {
    const { deps } = setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true));
    fake(deps, 'frueh', { kind: 'manual', createdAt: '2026-10-23T00:30:00.000Z' }); // 02:30 Berlin, vor 03:00
    expect(unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {})).nightlyMissing).toBe(true);
    fake(deps, 'hand', { kind: 'manual', createdAt: '2026-10-23T09:00:00.000Z' }); // 11:00 Berlin
    expect(unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {})).nightlyMissing).toBe(false);
    deps.close();
  });

  it('dropsWhenUnpinned: festgehaltenes Tagesbackup von vor 20 Tagen fiele, unpinBackup entfernt es gleich mit', async () => {
    const { deps, bp } = setup();
    for (let i = 0; i < 20; i++) fake(deps, `a${i}`, { kind: 'automatic', createdAt: daysAgo(i) });
    fake(deps, 'fest', { kind: 'automatic', createdAt: daysAgo(20), pinned: true });
    fake(deps, 'fest-neu', { kind: 'manual', createdAt: daysAgo(0), pinned: true });
    const overview = unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {}));
    expect(overview.items.find((i) => i.name === 'fest')).toMatchObject({ retention: { kind: 'pinned' }, dropsWhenUnpinned: true });
    expect(overview.items.find((i) => i.name === 'fest-neu')).toMatchObject({ dropsWhenUnpinned: false });
    expect(overview.items.find((i) => i.name === 'a0')).not.toHaveProperty('dropsWhenUnpinned');
    unwrap(await unpinBackup(deps, ctxWith(EXPORT), { name: 'fest' }));
    expect(unwrap(await listBackupArchives(deps, ctxWith(EXPORT), {})).items.map((i) => i.name)).not.toContain('fest');
    expect(existsSync(path.join(bp, 'fest.json'))).toBe(false);
    expect(auditEntry(deps, 'backup.unpin').entityId).toBe('fest');
    expect(JSON.parse(auditEntry(deps, 'backup.prune').params!)).toEqual({ count: 1 });
    deps.close();
  });

  it('startBackup startet einen Lauf und meldet einen laufenden statt eines zweiten', async () => {
    const { deps, bp } = setup();
    const ctx = ctxWith(EXPORT);
    const first = unwrap(await startBackup(deps, ctx, {}));
    expect(first).toMatchObject({ started: true });
    expect(unwrap(await startBackup(deps, ctx, {}))).toMatchObject({ started: false, running: { kind: 'create' } });
    expect(code(await startBackup(deps, ctxWith([]), {}))).toBe('forbidden');
    const record = await waitForJob(backupJobSlot(bp), (first as { runId: string }).runId);
    expect(record).toMatchObject({ status: 'success', meta: { backupKind: 'manual' } });
    const status = unwrap(await backupJobStatus(deps, ctx, {}));
    expect(status.running).toBeNull();
    expect(status.last).toMatchObject({ create: { status: 'success' }, verify: null, restore: null });
    deps.close();
  });

  it('startBackupVerification prüft ein vorhandenes Backup und schreibt das Ergebnis; notFound für ein fehlendes', async () => {
    const { deps, bp } = setup();
    fake(deps, 'nur-bytes', { sidecar: false });
    const started = unwrap(await startBackupVerification(deps, ctxWith(EXPORT), { name: 'nur-bytes' }));
    if (!started.started) throw new Error('busy');
    expect(await waitForJob(backupJobSlot(bp), started.runId)).toMatchObject({ kind: 'verify', status: 'failed', meta: { name: 'nur-bytes' } });
    expect(readSidecar(bp, 'nur-bytes')).toMatchObject({ kind: 'unknown', verification: { status: 'failed' } });
    expect(JSON.parse(auditEntry(deps, 'backup.verify').params!)).toMatchObject({ passed: false });
    expect(code(await startBackupVerification(deps, ctxWith(EXPORT), { name: 'gibtsnicht' }))).toBe('notFound');
    expect(code(await startBackupVerification(deps, ctxWith(EXPORT), {}))).toBe('validation');
    expect(code(await startBackupVerification(deps, ctxWith([]), { name: 'nur-bytes' }))).toBe('forbidden');
    deps.close();
  });

  it('pinBackup hält höchstens drei fest', async () => {
    const { deps } = setup();
    const ctx = ctxWith(EXPORT);
    const names = ['b1', 'b2', 'b3', 'b4'].map((n, i) => fake(deps, n, { createdAt: daysAgo(i) }));
    for (const n of names.slice(0, 3)) unwrap(await pinBackup(deps, ctx, { name: n }));
    const fourth = await pinBackup(deps, ctx, { name: names[3] });
    expect(fourth.ok === false && fourth.error.type === 'conflict' && fourth.error.code).toBe('backupPinLimit');
    expect(auditEntry(deps, 'backup.pin').entityId).toBe(names[2]);
    expect(code(await pinBackup(deps, ctxWith([]), { name: 'b4' }))).toBe('forbidden');
    deps.close();
  });

  it('pinBackup auf ein schon festgehaltenes ändert nur den Namen und zählt nicht gegen die Grenze', async () => {
    const { deps, bp } = setup();
    const ctx = ctxWith(EXPORT);
    for (const n of ['b1', 'b2', 'b3']) unwrap(await pinBackup(deps, ctx, { name: fake(deps, n) }));
    expect(unwrap(await pinBackup(deps, ctx, { name: 'b2', label: '  Jahresabschluss  ' }))).toMatchObject({ pinned: true, pinnedLabel: 'Jahresabschluss' });
    expect(JSON.parse(auditEntry(deps, 'backup.pin').params!)).toEqual({ renamed: true });
    expect(unwrap(await pinBackup(deps, ctx, { name: 'b2', label: '' }))).toMatchObject({ pinnedLabel: null });
    expect(readSidecar(bp, 'b2')).toMatchObject({ pinned: true, pinnedLabel: null });
    expect(audits(deps, 'backup.pin').map((e) => JSON.parse(e.params!).renamed)).toEqual([false, false, false, true, true]);
    deps.close();
  });

  it('pinBackup auf ein Archiv ohne Begleitdatei legt eine an (Art unknown)', async () => {
    const { deps, bp } = setup();
    fake(deps, 'abgelegt', { sidecar: false });
    unwrap(await pinBackup(deps, ctxWith(EXPORT), { name: 'abgelegt' }));
    expect(readSidecar(bp, 'abgelegt')).toMatchObject({ kind: 'unknown', pinned: true, sizeBytes: 1000, verification: { status: 'unverified' } });
    deps.close();
  });

  it('pinBackup speichert label getrimmt als pinnedLabel, 61 Zeichen → validation; unpinBackup löscht es', async () => {
    const { deps, bp } = setup();
    const ctx = ctxWith(EXPORT);
    fake(deps, 'x');
    expect(code(await pinBackup(deps, ctx, { name: 'x', label: 'a'.repeat(61) }))).toBe('validation');
    expect(unwrap(await pinBackup(deps, ctx, { name: 'x', label: ` ${'a'.repeat(60)} ` }))).toMatchObject({ pinnedLabel: 'a'.repeat(60) });
    expect(unwrap(await unpinBackup(deps, ctx, { name: 'x' }))).toMatchObject({ pinned: false, pinnedLabel: null });
    expect(readSidecar(bp, 'x')).toMatchObject({ pinned: false, pinnedLabel: null });
    expect(auditEntry(deps, 'backup.unpin').entityId).toBe('x');
    expect(code(await unpinBackup(deps, ctxWith([]), { name: 'x' }))).toBe('forbidden');
    expect(code(await pinBackup(deps, ctx, { name: 'fehlt' }))).toBe('notFound');
    deps.close();
  });

  it('deleteBackup braucht backup.import, löscht auch festgehaltene, verweigert während eines Laufs und für das neueste geprüfte', async () => {
    const { deps, clock, bp } = setup();
    fake(deps, 'neu', { createdAt: daysAgo(0) });
    fake(deps, 'alt', { createdAt: daysAgo(5), pinned: true, kind: 'automatic' });
    expect(code(await deleteBackup(deps, ctxWith(EXPORT), { name: 'alt' }))).toBe('forbidden');
    expect(code(await deleteBackup(deps, ctxWith(ALL), { name: 'neu' }))).toBe('backupLastVerified');
    const h = beginJob(backupJobSlot(bp), clock, { kind: 'verify', steps: ['verify'], source: 'ui', userId: null, runId: 'R1' });
    expect(code(await deleteBackup(deps, ctxWith(ALL), { name: 'alt' }))).toBe('jobRunning');
    if (!('busy' in h)) endJob(backupJobSlot(bp), 'R1');
    expect(unwrap(await deleteBackup(deps, ctxWith(ALL), { name: 'alt' }))).toEqual({ deleted: 'alt' });
    expect(existsSync(path.join(bp, 'alt.tar'))).toBe(false);
    expect(existsSync(path.join(bp, 'alt.json'))).toBe(false);
    expect(JSON.parse(auditEntry(deps, 'backup.delete').params!)).toEqual({ kind: 'automatic' });
    expect(code(await deleteBackup(deps, ctxWith(ALL), { name: 'alt' }))).toBe('notFound');
    expect(code(await deleteBackup(deps, ctxWith(ALL), {}))).toBe('validation');
    deps.close();
  });

  it('openBackupDownload: notFound für ../x, für .work-…, für fehlendes Archiv; protokolliert nur bei rangeStart 0', async () => {
    const { deps, bp } = setup();
    const ctx = ctxWith(EXPORT);
    fake(deps, 'da');
    writeFileSync(path.join(bp, '.work-R1.tar'), 'x');
    expect(code(await openBackupDownload(deps, ctx, { name: '../x', rangeStart: 0 }))).toBe('notFound');
    expect(code(await openBackupDownload(deps, ctx, { name: '.work-R1', rangeStart: 0 }))).toBe('notFound');
    expect(code(await openBackupDownload(deps, ctx, { name: 'fehlt', rangeStart: 0 }))).toBe('notFound');
    expect(code(await openBackupDownload(deps, ctxWith([]), { name: 'da', rangeStart: 0 }))).toBe('forbidden');
    expect(code(await openBackupDownload(deps, ctx, { name: 'da', rangeStart: -1 }))).toBe('validation');
    expect(unwrap(await openBackupDownload(deps, ctx, { name: 'da', rangeStart: 0 }))).toEqual({ archivePath: path.join(bp, 'da.tar'), sizeBytes: 1000, fileName: 'da.tar' });
    unwrap(await openBackupDownload(deps, ctx, { name: 'da', rangeStart: 500 }));
    expect(audits(deps, 'backup.download')).toHaveLength(1);
    expect(auditEntry(deps, 'backup.download').entityId).toBe('da');
    deps.close();
  });

  it('cancelBackupJob: jobNotRunning bei fremder runId; protokolliert backup.cancel mit jobKind; restore verlangt backup.import', async () => {
    const { deps, clock, bp } = setup();
    const slot = backupJobSlot(bp);
    expect(code(await cancelBackupJob(deps, ctxWith(EXPORT), { runId: 'R1' }))).toBe('jobNotRunning');
    const h = beginJob(slot, clock, { kind: 'verify', steps: ['verify'], source: 'ui', userId: null, runId: 'R1' });
    if ('busy' in h) throw new Error('busy');
    expect(code(await cancelBackupJob(deps, ctxWith(EXPORT), { runId: 'R2' }))).toBe('jobNotRunning');
    h.setCancellable(false);
    expect(code(await cancelBackupJob(deps, ctxWith(EXPORT), { runId: 'R1' }))).toBe('jobNotCancellable');
    h.setCancellable(true);
    expect(code(await cancelBackupJob(deps, ctxWith([]), { runId: 'R1' }))).toBe('forbidden');
    expect(unwrap(await cancelBackupJob(deps, ctxWith(EXPORT), { runId: 'R1' }))).toEqual({ cancelled: true });
    expect(h.signal.aborted).toBe(true);
    expect(JSON.parse(auditEntry(deps, 'backup.cancel').params!)).toEqual({ jobKind: 'verify' });
    endJob(slot, 'R1');
    const r = beginJob(slot, clock, { kind: 'restore', steps: ['safeguard'], source: 'ui', userId: null, runId: 'R3' });
    expect(code(await cancelBackupJob(deps, ctxWith(EXPORT), { runId: 'R3' }))).toBe('forbidden');
    expect(unwrap(await cancelBackupJob(deps, ctxWith(ALL), { runId: 'R3' }))).toEqual({ cancelled: true });
    if (!('busy' in r)) endJob(slot, 'R3');
    expect(code(await cancelBackupJob(deps, ctxWith(EXPORT), {}))).toBe('validation');
    deps.close();
  });

  it('backupJobStatus liefert running und last je Art', async () => {
    const { deps, clock, bp } = setup();
    const slot = backupJobSlot(bp);
    const h = beginJob(slot, clock, { kind: 'verify', steps: ['verify'], source: 'ui', userId: null, runId: 'R1' });
    expect(unwrap(await backupJobStatus(deps, ctxWith(EXPORT), {}))).toEqual({ running: expect.objectContaining({ runId: 'R1', kind: 'verify' }), last: { create: null, verify: null, restore: null } });
    if (!('busy' in h)) endJob(slot, 'R1');
    expect(code(await backupJobStatus(deps, ctxWith([]), {}))).toBe('forbidden');
    deps.close();
  });

  it('ohne backupPath: backupPathMissing in jedem Dienst', async () => {
    const { deps } = setup(false);
    const ctx = ctxWith(ALL);
    const calls: Promise<Result<unknown>>[] = [
      listBackupArchives(deps, ctx, {}),
      startBackup(deps, ctx, {}),
      startBackupVerification(deps, ctx, { name: 'x' }),
      backupJobStatus(deps, ctx, {}),
      cancelBackupJob(deps, ctx, { runId: 'R' }),
      pinBackup(deps, ctx, { name: 'x' }),
      unpinBackup(deps, ctx, { name: 'x' }),
      deleteBackup(deps, ctx, { name: 'x' }),
      openBackupDownload(deps, ctx, { name: 'x', rangeStart: 0 }),
    ];
    for (const result of await Promise.all(calls)) expect(code(result)).toBe('backupPathMissing');
    deps.close();
  });
});
