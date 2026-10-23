import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { backupJobSlot } from '../src/backup/jobs';
import { checkBackupHealth, isNightlyBackupMissing, isScheduledBackupDue, NIGHTLY_GRACE_MINUTES, runBackupSchedule, wallClockInZone } from '../src/backup/schedule';
import { listBackups } from '../src/backup/sidecar';
import { readBackupState, updateBackupState } from '../src/backup/state';
import { fixedClock } from '../src/clock';
import { userRoles } from '../src/db/schema';
import { beginJob, endJob, runningJob, waitForJob, writeJsonAtomic } from '../src/jobs';
import { jobResultFile } from '../src/jobs/run-state';
import { defineModule } from '../src/modules/manifest';
import { writeSettingInternal } from '../src/settings/service';
import type { SystemMailMessage } from '../src/system-mail';
import { insertRole, insertUser, systemContext } from '../src/testing';

const hooks = vi.hoisted(() => ({ failWrite: false }));
vi.mock('../src/backup/write', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/write')>();
  return {
    ...real,
    writeBackupArchive: (async (source, opts) => {
      if (hooks.failWrite) throw new Error('Platte voll');
      return real.writeBackupArchive(source, opts);
    }) as typeof real.writeBackupArchive,
  };
});

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-schedule-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  hooks.failWrite = false;
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('fehlendes nächtliches Backup', () => {
  it('wallClockInZone liefert HH:MM in der Zone', () => {
    expect(wallClockInZone(new Date('2026-10-23T01:20:00Z'), 'Europe/Berlin')).toBe('03:20');
    expect(wallClockInZone(new Date('2026-10-26T02:00:00Z'), 'Europe/Berlin')).toBe('03:00');
    expect(NIGHTLY_GRACE_MINUTES).toBe(20);
  });

  it.each([
    // now (UTC)              enabled time     verifiedSinceTime missing
    ['2026-10-23T01:19:00Z', true, '03:00', false, false], // 03:19 Berlin
    ['2026-10-23T01:20:00Z', true, '03:00', false, true],
    ['2026-10-23T01:20:00Z', true, '03:00', true, false],
    ['2026-10-23T01:20:00Z', false, '03:00', false, false],
    ['2026-10-23T22:30:00Z', true, '23:50', false, false], // 00:30 am 24.: neuer Tag, Uhrzeit noch nicht erreicht
    ['2026-10-23T21:55:00Z', true, '23:50', false, false], // 23:55: Uhrzeit + 20 min reicht über Mitternacht
  ])('isNightlyBackupMissing %s %s %s %s → %s', (now, enabled, time, verifiedSinceTime, missing) => {
    expect(isNightlyBackupMissing({ now: new Date(now), timeZone: 'Europe/Berlin', enabled, time, verifiedSinceTime })).toBe(missing);
  });
});

describe('Zeitplan', () => {
  it.each([
    // now (UTC)              time     lastAttemptDay  automaticToday  due
    ['2026-10-23T00:59:00Z', '03:00', null, false, false], // 02:59 Berlin (Sommerzeit)
    ['2026-10-23T01:00:00Z', '03:00', null, false, true],
    ['2026-10-23T21:59:00Z', '03:00', '2026-10-23', false, false], // schon versucht
    ['2026-10-23T22:01:00Z', '03:00', '2026-10-23', false, false], // 00:01 am 24., vor 03:00
    ['2026-10-24T02:00:00Z', '03:00', '2026-10-23', false, true], // 04:00 am 24., nachholen
    ['2026-10-26T02:00:00Z', '03:00', '2026-10-25', false, true], // nach der Umstellung auf Winterzeit: 03:00 Berlin
    ['2026-10-23T05:00:00Z', '03:00', null, true, false],
    ['2026-10-23T21:59:00Z', '03:00', null, false, true], // 23:59 ohne Versuch: Neustart um 3 Uhr wird nachgeholt
  ])('%s %s %s %s → %s', (now, time, last, auto, due) => {
    expect(isScheduledBackupDue({ now: new Date(now), timeZone: 'Europe/Berlin', enabled: true, time, lastAttemptDay: last, automaticToday: auto })).toBe(due);
  });
  it('aus → nie fällig', () => {
    expect(isScheduledBackupDue({ now: new Date('2026-10-23T05:00:00Z'), timeZone: 'Europe/Berlin', enabled: false, time: '03:00', lastAttemptDay: null, automaticToday: false })).toBe(false);
  });
});

function setup(opts: { now?: string; enabled?: boolean; withPath?: boolean } = {}) {
  const sent: SystemMailMessage[] = [];
  const mailer = defineModule({ key: 'mailer', version: '1', permissions: [], systemMail: { available: () => true, send: async (_d, m) => { sent.push(m); return { sent: true }; } } });
  const clock = fixedClock(opts.now ?? '2026-10-23T02:00:00.000Z'); // 04:00 Berlin
  const deps = createDeps({ dataPath: tmp(), ...(opts.withPath === false ? {} : { backupPath: tmp() }), env: 'test', clock, modules: [mailer] });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['mailer']);
    if (opts.enabled !== false) writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true);
  });
  const admin = insertUser(deps, { name: 'Admin', email: 'admin@example.org' });
  deps.db.insert(userRoles).values({ userId: admin, roleId: insertRole(deps, { name: 'Admin', isProtected: true }) }).run();
  return { deps, clock, sent, bp: deps.backupPath! };
}

async function settle(deps: AppDeps) {
  const slot = backupJobSlot(deps.backupPath!);
  const run = runningJob(slot);
  if (run) await waitForJob(slot, run.runId);
}

describe('runBackupSchedule', { timeout: 20_000 }, () => {
  it('aus → disabled, ohne backupPath → noPath', async () => {
    const off = setup({ enabled: false });
    expect(await runBackupSchedule(off.deps)).toBe('disabled');
    off.deps.close();
    const none = setup({ withPath: false });
    expect(await runBackupSchedule(none.deps)).toBe('noPath');
    none.deps.close();
  });

  it('vor der Uhrzeit notDue', async () => {
    const { deps } = setup({ now: '2026-10-23T00:30:00.000Z' });
    expect(await runBackupSchedule(deps)).toBe('notDue');
    deps.close();
  });

  it('startet einmal je Vereinstag ein automatisches Backup und holt es am Folgetag wieder', async () => {
    const { deps, clock, bp } = setup();
    expect(await runBackupSchedule(deps)).toBe('started');
    expect(readBackupState(bp).lastScheduleAttemptDay).toBe('2026-10-23');
    await settle(deps);
    expect(listBackups(bp).map((i) => [i.kind, i.verification.status])).toEqual([['automatic', 'passed']]);
    clock.advance(10 * 60_000);
    expect(await runBackupSchedule(deps)).toBe('notDue');
    clock.set('2026-10-23T21:59:00.000Z'); // 23:59 Berlin
    expect(await runBackupSchedule(deps)).toBe('notDue');
    clock.set('2026-10-24T01:10:00.000Z'); // 03:10 am 24.
    expect(await runBackupSchedule(deps)).toBe('started');
    await settle(deps);
    deps.close();
  });

  it('ein gescheiterter Lauf wird nicht alle 10 Minuten wiederholt und mailt genau einmal', async () => {
    const { deps, clock, sent, bp } = setup();
    hooks.failWrite = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runBackupSchedule(deps)).toBe('started');
    await settle(deps);
    for (let i = 0; i < 3; i++) {
      clock.advance(10 * 60_000);
      expect(await runBackupSchedule(deps)).toBe('notDue');
      await checkBackupHealth(deps);
    }
    errors.mockRestore();
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'createFailed', kind: 'automatic', mailed: true });
    expect(sent).toHaveLength(1);
    deps.close();
  });

  it('besetzter Platz → busy, Versuchstag bleibt leer (nächster Takt versucht wieder)', async () => {
    const { deps, clock, bp } = setup();
    const slot = backupJobSlot(bp);
    const h = beginJob(slot, clock, { kind: 'verify', steps: ['verify'], source: 'ui', userId: null, runId: 'R1' });
    if ('busy' in h) throw new Error('busy');
    expect(await runBackupSchedule(deps)).toBe('busy');
    expect(readBackupState(bp).lastScheduleAttemptDay).toBeNull();
    endJob(slot, 'R1');
    deps.close();
  });
});

describe('checkBackupHealth', { timeout: 20_000 }, () => {
  it('Speicher-Vorwarnung an drei Takten eines Tages → eine Mail; am nächsten Tag wieder eine', async () => {
    const { deps, clock, sent } = setup({ enabled: false });
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 1, blocks: 100 } as fs.StatsFs);
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 1, bsize: 1, blocks: 100 } as fs.StatsFs);
    fs.writeFileSync(path.join(deps.backupPath!, 'x.tar'), 'x');
    const { writeSidecar } = await import('../src/backup/sidecar');
    writeSidecar(deps.backupPath!, { version: 1, name: 'x', kind: 'manual', createdAt: '2026-10-22T10:00:00.000Z', sizeBytes: 1000, sha256: null, manifest: null, verification: { status: 'passed', at: '2026-10-22T10:00:00.000Z' }, pinned: false, pinnedLabel: null });
    for (let i = 0; i < 3; i++) {
      await checkBackupHealth(deps);
      clock.advance(10 * 60_000);
    }
    expect(sent).toHaveLength(1);
    clock.advance(24 * 3_600_000);
    await checkBackupHealth(deps);
    expect(sent).toHaveLength(2);
    deps.close();
  });

  it('meldet storageLow/notMounted einmal je Tag, einen unterbrochenen Lauf genau einmal und schickt einen nicht gemailten letzten Fehler nach', async () => {
    const { deps, clock, sent, bp } = setup({ enabled: false });
    // kein geprüftes Backup → keine Platzwarnung; mit einem und knappem Platz schon
    await checkBackupHealth(deps);
    expect(sent).toEqual([]);

    deps.backupMountWarning = 'notMounted';
    await checkBackupHealth(deps);
    await checkBackupHealth(deps);
    expect(sent).toHaveLength(1);

    const slot = backupJobSlot(bp);
    fs.mkdirSync(slot.dir, { recursive: true });
    writeJsonAtomic(jobResultFile(slot, 'create'), { kind: 'create', runId: 'RUN-1', startedAt: '2026-10-23T01:00:00.000Z', finishedAt: '2026-10-23T01:01:00.000Z', userId: null, status: 'interrupted', steps: [], meta: { backupKind: 'automatic' } });
    await checkBackupHealth(deps);
    expect(readBackupState(bp)).toMatchObject({ lastError: { code: 'interrupted', kind: 'automatic', mailed: true }, lastReportedRunId: 'RUN-1' });
    await checkBackupHealth(deps);
    expect(sent).toHaveLength(2);

    updateBackupState(bp, { lastError: { code: 'preUpdateFailed', at: '2026-10-23T01:00:00.000Z', kind: 'preUpdate', name: null, reason: 'x', mailed: false } });
    await checkBackupHealth(deps);
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'preUpdateFailed', mailed: true });
    expect(sent).toHaveLength(3);
    await checkBackupHealth(deps);
    expect(sent).toHaveLength(3);

    clock.advance(24 * 3_600_000);
    await checkBackupHealth(deps);
    expect(sent).toHaveLength(4); // notMounted am nächsten Tag wieder
    deps.close();
  });
});
