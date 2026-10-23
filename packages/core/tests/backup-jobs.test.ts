import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { launchBackupCreate } from '../src/backup/create';
import { backupJobSlot, type BackupCreateResult } from '../src/backup/jobs';
import { readSidecar } from '../src/backup/sidecar';
import { fixedClock } from '../src/clock';
import { auditLog, users } from '../src/db/schema';
import { readJobResult, requestJobCancel, runningJob } from '../src/jobs';
import { unwrap, type Result } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { auditEntry, ctxWith } from '../src/testing';

const hooks = vi.hoisted(() => ({
  verify: null as null | { ok: false; reason: 'backupCorrupt'; manifest: null; sha256: null },
  holdFiles: false,
}));

vi.mock('../src/backup/verify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/verify')>();
  return { ...real, verifyBackupArchive: (async (...args: Parameters<typeof real.verifyBackupArchive>) => hooks.verify ?? real.verifyBackupArchive(...args)) as typeof real.verifyBackupArchive };
});
vi.mock('../src/backup/write', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/write')>();
  return {
    ...real,
    writeBackupArchive: (async (source, opts) => {
      // Hält den Schritt „Dateien schreiben“ an, bis jemand abbricht — dann läuft das Echte mit dem abgebrochenen Signal.
      if (hooks.holdFiles && opts.signal) await new Promise<void>((resolve) => opts.signal!.addEventListener('abort', () => resolve(), { once: true }));
      return real.writeBackupArchive(source, opts);
    }) as typeof real.writeBackupArchive,
  };
});

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-jobs-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  hooks.verify = null;
  hooks.holdFiles = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const clock = fixedClock('2026-10-23T10:00:00.000Z');
  const deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test', clock });
  await seedDevelopment(deps);
  const admin = deps.db.select().from(users).all()[0]!;
  const ctx = ctxWith(['backup.export', 'backup.import'], admin.id);
  return { deps, ctx, clock, bp: deps.backupPath! };
}

async function create(deps: AppDeps, ctx: ReturnType<typeof ctxWith>): Promise<Result<BackupCreateResult>> {
  const started = launchBackupCreate(deps, ctx, 'manual', 'ui');
  if ('busy' in started) throw new Error('busy');
  return started.done;
}

const auditCount = (deps: AppDeps, action: string) => deps.db.select().from(auditLog).all().filter((e) => e.action === action).length;

describe('Backup als Lauf', { timeout: 20_000 }, () => {
  it('erstellt, prüft und beschreibt ein Backup', async () => {
    const { deps, ctx, bp } = await setup();
    const result = unwrap(await create(deps, ctx));
    expect(result.name).toMatch(/^kompass-backup-test-\d{8}-\d{6}-manual$/);
    expect(readSidecar(bp, result.name)).toMatchObject({ kind: 'manual', verification: { status: 'passed' }, pinned: false, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(readJobResult(backupJobSlot(bp), 'create')?.steps.map((s) => [s.key, s.state])).toEqual([
      ['database', 'done'],
      ['files', 'done'],
      ['verify', 'done'],
      ['prune', 'done'],
    ]);
    expect(JSON.parse(auditEntry(deps, 'backup.create').params!)).toEqual({ kind: 'manual', sizeBytes: result.sidecar.sizeBytes });
    expect(JSON.parse(auditEntry(deps, 'backup.verify').params!)).toEqual({ passed: true, reason: null });
    expect(auditEntry(deps, 'backup.create').entityId).toBe(result.name);
    expect(result.pruned).toEqual([]);
    expect(result.pruneError).toBeNull();
    expect(readdirSync(bp).filter((n) => n.startsWith('.work-'))).toEqual([]);
    deps.close();
  });

  it('ein zweites Von Hand ersetzt das erste erst nach bestandener Prüfung und protokolliert das Aufräumen', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const first = unwrap(await create(deps, ctx));
    clock.advance(60_000);
    hooks.verify = { ok: false, reason: 'backupCorrupt', manifest: null, sha256: null };
    const failed = await create(deps, ctx);
    expect(failed.ok).toBe(false);
    expect(existsSync(path.join(bp, `${first.name}.tar`))).toBe(true);
    hooks.verify = null;
    clock.advance(60_000);
    const third = unwrap(await create(deps, ctx));
    expect(third.pruned).toHaveLength(2);
    expect(third.pruned).toContain(first.name);
    expect(existsSync(path.join(bp, `${first.name}.tar`))).toBe(false);
    expect(existsSync(path.join(bp, `${first.name}.json`))).toBe(false);
    const prune = auditEntry(deps, 'backup.prune');
    expect(JSON.parse(prune.params!)).toEqual({ count: 2 });
    expect(prune.entityId).toBeNull();
    deps.close();
  });

  it('entfernt beim Aufräumen eine Begleitdatei ohne Archiv', async () => {
    const { deps, ctx, bp } = await setup();
    writeFileSync(path.join(bp, 'kompass-backup-test-20260101-000000-manual.json'), '{}');
    unwrap(await create(deps, ctx));
    expect(existsSync(path.join(bp, 'kompass-backup-test-20260101-000000-manual.json'))).toBe(false);
    expect(auditCount(deps, 'backup.prune')).toBe(0);
    deps.close();
  });

  it('Abbruch im Schritt files: kein Archiv, keine Begleitdatei, keine .work-Datei, backup.fail mit reason cancelled', async () => {
    const { deps, ctx, bp } = await setup();
    hooks.holdFiles = true;
    const started = launchBackupCreate(deps, ctx, 'manual', 'ui');
    if ('busy' in started) throw new Error('busy');
    const slot = backupJobSlot(bp);
    for (let i = 0; i < 200 && runningJob(slot)?.steps.find((s) => s.key === 'files')?.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(requestJobCancel(slot, started.run.runId)).toBe(true);
    const result = await started.done;
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('jobCancelled');
    expect(readdirSync(bp).filter((n) => n !== '.jobs')).toEqual([]);
    expect(JSON.parse(auditEntry(deps, 'backup.fail').params!)).toEqual({ kind: 'manual', reason: 'cancelled' });
    expect(readJobResult(slot, 'create')).toMatchObject({ status: 'aborted', reason: 'cancelled', lastStep: 'files' });
    deps.close();
  });

  it('gescheiterte Prüfung: Begleitdatei failed, kein Aufräumen, Ergebnis failed mit backupVerifyFailed', async () => {
    const { deps, ctx, bp } = await setup();
    hooks.verify = { ok: false, reason: 'backupCorrupt', manifest: null, sha256: null };
    const result = await create(deps, ctx);
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('backupVerifyFailed');
    const record = readJobResult(backupJobSlot(bp), 'create')!;
    expect(record).toMatchObject({ status: 'failed', error: { code: 'backupVerifyFailed', params: { reason: 'backupCorrupt' } } });
    expect(record.steps.find((s) => s.key === 'prune')?.state).toBe('pending');
    const name = readdirSync(bp).find((n) => n.endsWith('.tar'))!.slice(0, -4);
    expect(readSidecar(bp, name)).toMatchObject({ verification: { status: 'failed', reason: 'backupCorrupt' } });
    expect(JSON.parse(auditEntry(deps, 'backup.verify').params!)).toEqual({ passed: false, reason: 'backupCorrupt' });
    deps.close();
  });

  it('ein zweiter Start während des ersten bekommt den laufenden', async () => {
    const { deps, ctx } = await setup();
    const a = launchBackupCreate(deps, ctx, 'manual', 'ui');
    const b = launchBackupCreate(deps, ctx, 'manual', 'ui');
    expect('busy' in b && b.busy.kind).toBe('create');
    if (!('busy' in a)) await a.done;
    deps.close();
  });
});
