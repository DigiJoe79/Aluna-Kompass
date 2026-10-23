import { readdirSync, rmSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { isoDayInZone } from '../dates';
import { newId } from '../ids';
import { JobAbortedError, launchJob, runStep, type JobHandle, type JobRun, type JobSource } from '../jobs';
import { localizedConflict, ok, type Result } from '../result';
import { timeZoneOf } from '../today';
import { BACKUP_JOB_STEPS, BACKUP_LIMITS, backupJobSlot, type BackupCreateResult, type BackupFailureReason } from './jobs';
import { BACKUP_WORK_PREFIX } from './paths';
import { ringCountsOf, selectPrunable } from './ring';
import { backupFileName, backupFiles, listBackups, readSidecar, uniqueBackupName, writeSidecar, type BackupKind, type BackupSidecar } from './sidecar';
import { clearBackupProblem, reportBackupProblem } from './notify';
import type { BackupProblem } from './state';
import { verifyBackupArchive } from './verify';
import { backupSourceOf, snapshotDatabase, writeBackupArchive } from './write';

/*
 * Innenleben der Backup-Läufe, nicht aus `index.ts` exportiert: Die Dienste (`services.ts`) prüfen Rechte und
 * `backupPath`, B3 (Einspielen) und B4 (Zeitplan, Vor Update) rufen diese Teile direkt.
 */

const requireBackupPath = (deps: AppDeps): string => {
  if (!deps.backupPath) throw new Error('backupPath fehlt');
  return deps.backupPath;
};

const audit = (deps: AppDeps, ctx: CallContext, action: string, entityId: string | null, params: Record<string, string | number | boolean | null>, after?: unknown) =>
  deps.db.transaction((tx) => recordAudit(tx, deps, ctx, { action, entityType: 'backup', entityId, params, ...(after === undefined ? {} : { after }) }));

/** Meldet ein Problem (Spec § Meldungen). Eine Meldung darf den Lauf nicht kippen — deshalb gefangen, aber abgewartet. */
async function report(deps: AppDeps, problem: Omit<BackupProblem, 'at' | 'mailed'>): Promise<void> {
  try {
    await reportBackupProblem(deps, problem);
  } catch (error) {
    console.error('[backup] Meldung gescheitert', error);
  }
}

const failureReason = (error: unknown): BackupFailureReason => (error instanceof JobAbortedError ? (error.reason === 'cancelled' ? 'cancelled' : 'timeout') : 'writeFailed');

/**
 * Prüft ein vorhandenes Backup im Schritt `stepKey`: liest es ganz (`verifyBackupArchive`), schreibt das Ergebnis in
 * die Begleitdatei (fehlt sie, entsteht eine mit Art `unknown`) und protokolliert `backup.verify`. Nicht bestanden →
 * `backupVerifyFailed` mit Grund.
 */
export async function produceVerification(deps: AppDeps, ctx: CallContext, name: string, h: JobHandle, stepKey: string): Promise<Result<BackupSidecar>> {
  const bp = requireBackupPath(deps);
  const files = backupFiles(bp, name);
  if (!files) throw new Error(`invalid backup name: ${name}`);
  return runStep(h, stepKey, BACKUP_LIMITS.verify!, async (c) => {
    const existing = readSidecar(bp, name);
    const outcome = await verifyBackupArchive(files.archive, { workDir: bp, expectedSha256: existing?.sha256 ?? null, signal: c.signal, onProgress: (done, total) => c.progress(done, total) });
    const at = isoNow(deps.clock);
    const base: BackupSidecar = existing ?? {
      version: 1,
      name,
      kind: 'unknown',
      createdAt: statSync(files.archive).mtime.toISOString(),
      sizeBytes: statSync(files.archive).size,
      sha256: null,
      manifest: null,
      verification: { status: 'unverified' },
      pinned: false,
      pinnedLabel: null,
    };
    const sidecar: BackupSidecar = outcome.ok
      ? { ...base, sha256: outcome.sha256, sizeBytes: outcome.sizeBytes, manifest: outcome.manifest, verification: { status: 'passed', at } }
      : { ...base, sha256: base.sha256 ?? outcome.sha256, manifest: base.manifest ?? outcome.manifest, verification: { status: 'failed', at, reason: outcome.reason } };
    writeSidecar(bp, sidecar);
    audit(deps, ctx, 'backup.verify', name, { passed: outcome.ok, reason: outcome.ok ? null : outcome.reason });
    if (!outcome.ok) {
      await report(deps, { code: 'verifyFailed', kind: sidecar.kind === 'unknown' ? null : sidecar.kind, name, reason: outcome.reason });
      return localizedConflict('backupVerifyFailed', 'backup.errors.backupVerifyFailed', { reason: outcome.reason });
    }
    return ok(sidecar);
  });
}

/**
 * Ein Backup der laufenden Installation in vier Schritten — für den Lauf `create` und, mit anderen Schrittnamen,
 * für `safeguard` beim Einspielen (B3). Ohne `prune` räumt der Ring nicht auf.
 */
export async function produceBackup(
  deps: AppDeps,
  ctx: CallContext,
  kind: BackupKind,
  h: JobHandle,
  steps: { database: string; files: string; verify: string; prune: string | null },
): Promise<Result<BackupCreateResult>> {
  const bp = requireBackupPath(deps);
  const createdAt = isoNow(deps.clock);
  const name = uniqueBackupName(bp, backupFileName(deps.env, createdAt, kind));
  const files = backupFiles(bp, name)!;
  h.setMeta({ name });
  const source = backupSourceOf(deps);
  const dbCopyPath = path.join(bp, `${BACKUP_WORK_PREFIX}${h.run.runId}.db`);
  const dropDbCopy = () => Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(dbCopyPath + suffix, { force: true })));

  let written: { manifest: BackupSidecar['manifest']; sizeBytes: number; sha256: string };
  try {
    const { counts } = await runStep(h, steps.database, BACKUP_LIMITS.database!, () => snapshotDatabase(source, dbCopyPath));
    written = await runStep(h, steps.files, BACKUP_LIMITS.files!, (c) =>
      writeBackupArchive(source, { dbCopyPath, counts, archivePath: files.archive, createdAt, signal: c.signal, onProgress: (done, total) => c.progress(done, total) }),
    );
  } catch (error) {
    await dropDbCopy();
    await rm(files.archive, { force: true });
    audit(deps, ctx, 'backup.fail', name, { kind, reason: failureReason(error) });
    // Von Hand sieht der Mensch den Fehler selbst; automatisch und vor dem Update niemand.
    if (kind === 'automatic' || kind === 'preUpdate') await report(deps, { code: 'createFailed', kind, name, reason: failureReason(error) });
    throw error;
  }
  await dropDbCopy();

  const sidecar: BackupSidecar = {
    version: 1,
    name,
    kind,
    createdAt,
    sizeBytes: written.sizeBytes,
    sha256: written.sha256,
    manifest: written.manifest,
    verification: { status: 'unverified' },
    pinned: false,
    pinnedLabel: null,
  };
  writeSidecar(bp, sidecar);
  audit(deps, ctx, 'backup.create', name, { kind, sizeBytes: written.sizeBytes });

  const verified = await produceVerification(deps, ctx, name, h, steps.verify);
  if (!verified.ok) return verified;
  try {
    clearBackupProblem(bp);
  } catch (error) {
    console.error('[backup] letzten Fehler nicht gelöscht', error);
  }

  let pruned: string[] = [];
  let pruneError: string | null = null;
  if (steps.prune) {
    // Das Backup steht; ein Abbruch an dieser Stelle hätte nichts mehr zu retten.
    h.setCancellable(false);
    try {
      const outcome = await runStep(h, steps.prune, BACKUP_LIMITS.prune!, () => pruneBackupRing(deps, ctx));
      pruned = outcome.pruned;
      pruneError = outcome.error;
    } catch (error) {
      pruneError = error instanceof Error ? error.message : String(error);
      h.skip(steps.prune);
    }
  }
  if (pruneError) await report(deps, { code: 'pruneFailed', kind, name, reason: pruneError });
  return ok({ name, sidecar: verified.value, pruned, pruneError });
}

/** Entfernt Archiv und Begleitdatei je Name; liefert die entfernten. Ohne Protokoll — das schreibt der Aufrufer. */
export function removeBackupFiles(backupPath: string, names: readonly string[]): string[] {
  const removed: string[] = [];
  for (const name of names) {
    const files = backupFiles(backupPath, name);
    if (!files) continue;
    rmSync(files.archive, { force: true });
    rmSync(files.sidecar, { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * Räumt den Ring auf: entfernt Archiv und Begleitdatei jedes Backups, das `selectPrunable` nennt, danach jede
 * Begleitdatei ohne Archiv. Wirft nicht — ein Fehler steht in `error`, das Backup davor gilt trotzdem.
 */
export async function pruneBackupRing(deps: AppDeps, ctx: CallContext): Promise<{ pruned: string[]; error: string | null }> {
  const bp = requireBackupPath(deps);
  const pruned: string[] = [];
  let error: string | null = null;
  try {
    const tz = timeZoneOf(deps);
    const today = isoDayInZone(deps.clock.now(), tz);
    pruned.push(...removeBackupFiles(bp, selectPrunable(listBackups(bp), ringCountsOf(deps), tz, today)));
    for (const entry of readdirSync(bp)) {
      if (entry.startsWith('.') || !entry.endsWith('.json')) continue;
      const files = backupFiles(bp, entry.slice(0, -'.json'.length));
      if (files && !statSync(files.archive, { throwIfNoEntry: false })) rmSync(files.sidecar, { force: true });
    }
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    console.error('[jobs:create] Aufräumen gescheitert', e);
  }
  if (pruned.length > 0) audit(deps, ctx, 'backup.prune', null, { count: pruned.length }, { names: pruned });
  return { pruned, error };
}

/** Startet den Lauf `create` für ein Backup der Art `kind`. Setzt `deps.backupPath` voraus. */
export function launchBackupCreate(
  deps: AppDeps,
  ctx: CallContext,
  kind: BackupKind,
  source: JobSource,
): { busy: JobRun } | { run: JobRun; done: Promise<Result<BackupCreateResult>> } {
  const bp = requireBackupPath(deps);
  return launchJob(
    backupJobSlot(bp),
    deps.clock,
    { kind: 'create', steps: BACKUP_JOB_STEPS.create, source, userId: ctx.userId, apiTokenId: ctx.apiTokenId, runId: newId(), meta: { backupKind: kind } },
    (h) => produceBackup(deps, ctx, kind, h, { database: 'database', files: 'files', verify: 'verify', prune: 'prune' }),
  );
}
