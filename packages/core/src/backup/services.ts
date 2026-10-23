import { rmSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { recordAudit, type AuditParam } from '../audit/log';
import type { CallContext } from '../context';
import { isoDayInZone } from '../dates';
import { newId } from '../ids';
import { jobRunningConflict, launchJob, readJobResult, requestJobCancel, runningJob, type JobRecord, type JobRun, type JobSource, type JobStart } from '../jobs';
import { requirePermission } from '../permissions/check';
import { localizedConflict, notFound, ok, type Failure, type Result } from '../result';
import { timeZoneOf } from '../today';
import { systemMailAvailable } from '../system-mail';
import { validate } from '../validate';
import { launchBackupCreate, produceVerification } from './create';
import { BACKUP_JOB_KINDS, BACKUP_JOB_STEPS, backupJobSlot, type BackupJobKind } from './jobs';
import { BACKUP_PIN_LABEL_MAX, BACKUP_PINNED_MAX, planRetention, ringCountsOf, type BackupRetention } from './ring';
import type { BackupMountWarning } from './paths';
import { backupScheduleOf, nightlyBackupMissing } from './schedule';
import { readBackupState, type BackupProblem } from './state';
import { backupStorage, type BackupStorage } from './storage';
import { backupFiles, listBackups, newestVerifiedBackup, writeSidecar, type BackupListItem, type BackupSidecar } from './sidecar';

/*
 * Dienste der Backup-Seite und (ab B5) der Agenten-Werkzeuge. Rechte: `backup.export` für Liste, Lauf, Prüfen,
 * Festhalten, Freigeben und Download; `backup.import` für Löschen (und Einspielen, B3). Die Dateien selbst liegen in
 * `BACKUP_PATH`; die Datenbank kennt sie nicht, sie überlebt ein Einspielen nicht.
 */

export interface BackupOverview {
  items: (BackupListItem & {
    /** Nicht zum Einspielen anbieten: aus einer neueren Fassung (mehr Migrationen), ohne Manifest oder gescheitert. */
    restorable: boolean;
    retention: BackupRetention;
    /** Nur bei festgehaltenen: Fiele es beim Freigeben sofort aus dem Ring? Dann fragt die Oberfläche „Freigeben und löschen?“. */
    dropsWhenUnpinned?: boolean;
  })[];
  pinnedMax: number;
  /** Belegt, frei, Vorwarnung; `null`, wenn sich das Verzeichnis nicht befragen lässt. */
  storage: BackupStorage | null;
  /** Der letzte Fehler bis zum nächsten gelungenen Backup (Spec § Meldungen). */
  lastError: BackupProblem | null;
  mountWarning: BackupMountWarning;
  /** Kann ein Modul Systemmails senden? Sonst sind Fehler nur auf der Seite sichtbar. */
  mailAvailable: boolean;
  schedule: { enabled: boolean; time: string };
  /** Zeitplan an und das nächtliche Backup von heute fehlt (Uhrzeit + 20 min). */
  nightlyMissing: boolean;
}

export interface BackupJobStatus {
  running: JobRun | null;
  last: Record<BackupJobKind, JobRecord | null>;
}

const emptySchema = z.object({});
export const backupNameSchema = z.object({ name: z.string().min(1).max(200) });
export const backupRunIdSchema = z.object({ runId: z.string().min(1) });
export const pinBackupSchema = z.object({ name: z.string().min(1).max(200), label: z.string().trim().max(BACKUP_PIN_LABEL_MAX).optional() });
const downloadSchema = z.object({ name: z.string().min(1).max(200), rangeStart: z.number().int().min(0).default(0) });

const pathMissing = (): Failure => localizedConflict('backupPathMissing', 'backup.errors.backupPathMissing');

/** Rechte, Eingabe und Verzeichnis in der Reihenfolge der Service-Signatur. */
function prepare<T>(deps: AppDeps, ctx: CallContext, permission: string, schema: z.ZodType<T>, input: unknown): Result<{ bp: string; value: T }> {
  const denied = requirePermission(ctx, permission);
  if (denied) return denied;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  if (!deps.backupPath) return pathMissing();
  return ok({ bp: deps.backupPath, value: parsed.value });
}

const audit = (deps: AppDeps, ctx: CallContext, action: string, entityId: string | null, params: Record<string, AuditParam>, extra: { before?: unknown; after?: unknown } = {}) =>
  deps.db.transaction((tx) => recordAudit(tx, deps, ctx, { action, entityType: 'backup', entityId, params, ...extra }));

const sourceOf = (ctx: CallContext): JobSource => (ctx.channel === 'mcp' ? 'mcp' : ctx.channel === 'system' ? 'system' : 'ui');

const todayOf = (deps: AppDeps) => {
  const tz = timeZoneOf(deps);
  return { tz, today: isoDayInZone(deps.clock.now(), tz) };
};

/** Das Backup aus der Liste (auch ohne Begleitdatei); `null`, wenn kein Archiv da ist. */
const findItem = (bp: string, name: string): BackupListItem | null => (backupFiles(bp, name) ? (listBackups(bp).find((i) => i.name === name) ?? null) : null);

/** Begleitdatei aus einem Listeneintrag: für Archive ohne Begleitdatei entsteht sie hier (Art `unknown`). */
const sidecarOf = ({ hasSidecar: _ignored, ...rest }: BackupListItem): BackupSidecar => rest;

/** Fiele `name` aus dem Ring, wenn es nicht festgehalten wäre? Dieselbe Rechnung wie das Aufräumen. */
function dropsWhenUnpinned(deps: AppDeps, items: readonly BackupListItem[], name: string): boolean {
  const { tz, today } = todayOf(deps);
  const freed = items.map((i) => (i.name === name ? { ...i, pinned: false } : i));
  return planRetention(freed, ringCountsOf(deps), tz, today).get(name)?.kind === 'prune';
}

export async function listBackupArchives(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<BackupOverview>> {
  const prepared = prepare(deps, ctx, 'backup.export', emptySchema, input ?? {});
  if (!prepared.ok) return prepared;
  const items = listBackups(prepared.value.bp);
  const { tz, today } = todayOf(deps);
  const plan = planRetention(items, ringCountsOf(deps), tz, today);
  return ok({
    items: items.map((item) => ({
      ...item,
      restorable: item.manifest !== null && item.manifest.migrationCount <= deps.migrationCount && item.verification.status !== 'failed',
      retention: plan.get(item.name) ?? { kind: 'kept' },
      ...(item.pinned ? { dropsWhenUnpinned: dropsWhenUnpinned(deps, items, item.name) } : {}),
    })),
    pinnedMax: BACKUP_PINNED_MAX,
    storage: await backupStorage(prepared.value.bp),
    lastError: readBackupState(prepared.value.bp).lastError,
    mountWarning: deps.backupMountWarning,
    mailAvailable: systemMailAvailable(deps),
    schedule: backupScheduleOf(deps),
    nightlyMissing: nightlyBackupMissing(deps),
  });
}

/**
 * Startet ein Backup „Von Hand“ im Hintergrund und kehrt sofort zurück. Läuft schon ein Backup-Lauf, meldet er ihn,
 * statt zu warten. Der Lauf ist ein nicht abgewarteter Promise im Node-Prozess (wie bei der Webseite).
 */
export async function startBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<JobStart>> {
  const prepared = prepare(deps, ctx, 'backup.export', emptySchema, input ?? {});
  if (!prepared.ok) return prepared;
  const started = launchBackupCreate(deps, ctx, 'manual', sourceOf(ctx));
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch(() => undefined); // launchJob protokolliert den Fehler und schreibt ihn ins Ergebnis
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

/** Prüft ein vorhandenes Backup erneut, etwa nach einem Plattenproblem. */
export async function startBackupVerification(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<JobStart>> {
  const prepared = prepare(deps, ctx, 'backup.export', backupNameSchema, input);
  if (!prepared.ok) return prepared;
  const { bp, value } = prepared.value;
  if (!findItem(bp, value.name)) return notFound('backup', value.name);
  const started = launchJob(
    backupJobSlot(bp),
    deps.clock,
    { kind: 'verify', steps: BACKUP_JOB_STEPS.verify, source: sourceOf(ctx), userId: ctx.userId, apiTokenId: ctx.apiTokenId, runId: newId(), meta: { name: value.name } },
    (h) => produceVerification(deps, ctx, value.name, h, 'verify'),
  );
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch(() => undefined);
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

export async function backupJobStatus(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<BackupJobStatus>> {
  const prepared = prepare(deps, ctx, 'backup.export', emptySchema, input ?? {});
  if (!prepared.ok) return prepared;
  const slot = backupJobSlot(prepared.value.bp);
  const running = runningJob(slot);
  const last = Object.fromEntries(BACKUP_JOB_KINDS.map((kind) => [kind, readJobResult(slot, kind)])) as Record<BackupJobKind, JobRecord | null>;
  return ok({ running, last });
}

/** Bricht den laufenden Backup-Lauf ab; ein Einspielen verlangt dafür zusätzlich `backup.import`. */
export async function cancelBackupJob(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ cancelled: true }>> {
  const prepared = prepare(deps, ctx, 'backup.export', backupRunIdSchema, input);
  if (!prepared.ok) return prepared;
  const slot = backupJobSlot(prepared.value.bp);
  const run = runningJob(slot);
  if (!run || run.runId !== prepared.value.value.runId) return localizedConflict('jobNotRunning', 'jobs.errors.jobNotRunning');
  if (run.kind === 'restore') {
    const denied = requirePermission(ctx, 'backup.import');
    if (denied) return denied;
  }
  if (!run.cancellable || !requestJobCancel(slot, run.runId)) return localizedConflict('jobNotCancellable', 'jobs.errors.jobNotCancellable');
  const name = run.meta.name;
  audit(deps, ctx, 'backup.cancel', typeof name === 'string' ? name : null, { jobKind: run.kind }, { after: { runId: run.runId, step: run.steps.find((s) => s.state === 'running')?.key ?? null } });
  return ok({ cancelled: true as const });
}

/**
 * Hält ein Backup fest: Es fällt aus jedem Ring, bis jemand es freigibt; höchstens drei. Auf ein schon festgehaltenes
 * ändert es nur den Namen (leer → kein Name) und zählt nicht gegen die Grenze (Designer 2026-10-23).
 */
export async function pinBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<BackupSidecar>> {
  const prepared = prepare(deps, ctx, 'backup.export', pinBackupSchema, input);
  if (!prepared.ok) return prepared;
  const { bp, value } = prepared.value;
  const items = listBackups(bp);
  const item = backupFiles(bp, value.name) ? items.find((i) => i.name === value.name) : undefined;
  if (!item) return notFound('backup', value.name);
  const pinnedLabel = value.label ? value.label : null;
  const renamed = item.pinned;
  if (!renamed && items.filter((i) => i.pinned).length >= BACKUP_PINNED_MAX) return localizedConflict('backupPinLimit', 'backup.errors.backupPinLimit', { max: BACKUP_PINNED_MAX });
  const sidecar: BackupSidecar = { ...sidecarOf(item), pinned: true, pinnedLabel };
  writeSidecar(bp, sidecar);
  audit(deps, ctx, 'backup.pin', value.name, { renamed }, { before: { pinnedLabel: item.pinnedLabel }, after: { pinnedLabel } });
  return ok(sidecar);
}

/**
 * Gibt ein festgehaltenes Backup frei. Fiele es danach sofort aus dem Ring, wird es gleich mit entfernt (protokolliert
 * wie eine Ring-Entfernung); die Oberfläche fragt vorher „Freigeben und löschen?“.
 */
export async function unpinBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<BackupSidecar>> {
  const prepared = prepare(deps, ctx, 'backup.export', backupNameSchema, input);
  if (!prepared.ok) return prepared;
  const { bp, value } = prepared.value;
  const items = listBackups(bp);
  const item = backupFiles(bp, value.name) ? items.find((i) => i.name === value.name) : undefined;
  if (!item) return notFound('backup', value.name);
  const sidecar: BackupSidecar = { ...sidecarOf(item), pinned: false, pinnedLabel: null };
  if (!item.pinned) return ok(sidecar);
  const drops = dropsWhenUnpinned(deps, items, value.name);
  writeSidecar(bp, sidecar);
  audit(deps, ctx, 'backup.unpin', value.name, {}, { before: { pinnedLabel: item.pinnedLabel } });
  if (drops) {
    const files = backupFiles(bp, value.name)!;
    rmSync(files.archive, { force: true });
    rmSync(files.sidecar, { force: true });
    audit(deps, ctx, 'backup.prune', null, { count: 1 }, { after: { names: [value.name] } });
  }
  return ok(sidecar);
}

/** Löscht ein Backup samt Begleitdatei, auch ein festgehaltenes — nur nicht das neueste geprüfte und nicht während eines Laufs. */
export async function deleteBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ deleted: string }>> {
  const prepared = prepare(deps, ctx, 'backup.import', backupNameSchema, input);
  if (!prepared.ok) return prepared;
  const { bp, value } = prepared.value;
  const running = runningJob(backupJobSlot(bp));
  if (running) return jobRunningConflict(running);
  const item = findItem(bp, value.name);
  if (!item) return notFound('backup', value.name);
  if (newestVerifiedBackup(bp)?.name === value.name) return localizedConflict('backupLastVerified', 'backup.errors.backupLastVerified');
  const files = backupFiles(bp, value.name)!;
  rmSync(files.archive, { force: true });
  rmSync(files.sidecar, { force: true });
  audit(deps, ctx, 'backup.delete', value.name, { kind: item.kind }, { before: { createdAt: item.createdAt, sizeBytes: item.sizeBytes, pinned: item.pinned } });
  return ok({ deleted: value.name });
}

/**
 * Für den Download-Route-Handler: wo die Datei liegt und wie groß sie ist. Protokolliert wird nur der Anfang
 * (`rangeStart` 0) — ein fortgesetzter Download ist derselbe.
 */
export async function openBackupDownload(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ archivePath: string; sizeBytes: number; fileName: string }>> {
  const prepared = prepare(deps, ctx, 'backup.export', downloadSchema, input);
  if (!prepared.ok) return prepared;
  const { bp, value } = prepared.value;
  const files = backupFiles(bp, value.name);
  const stat = files ? statSync(files.archive, { throwIfNoEntry: false }) : undefined;
  if (!files || !stat?.isFile()) return notFound('backup', value.name);
  if (value.rangeStart === 0) audit(deps, ctx, 'backup.download', value.name, {});
  return ok({ archivePath: files.archive, sizeBytes: stat.size, fileName: `${value.name}.tar` });
}

