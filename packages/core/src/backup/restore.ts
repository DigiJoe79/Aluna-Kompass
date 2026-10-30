import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { count, countDistinct, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { apiTokens, auditLog, sessions, users } from '../db/schema';
import type { AppEnv } from '../deps';
import { activeJobSlotKeys, JobAbortedError, launchJob, readJobResult, runningJob, runStep, type JobHandle, type JobSource, type JobStart } from '../jobs';
import { lastPublishedAt } from '../modules/published';
import { requireHumanChannel } from '../permissions/human';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, localizedConflict, notFound, ok, type Failure, type Result } from '../result';
import { readSetting, writeSettingInternal } from '../settings/service';
import { isSetupRequired } from '../setup/service';
import { formatTime, isoDayInZone } from '../dates';
import { timeZoneOf } from '../today';
import { userNamesFor } from '../users/names';
import { validate } from '../validate';
import { extractBackup } from './archive';
import { produceBackup, produceVerification, pruneBackupRing } from './create';
import { restoreHooks } from './hooks';
import { BACKUP_JOB_STEPS, BACKUP_LIMITS, backupJobSlot } from './jobs';
import { clearMaintenance, readMaintenance, writeMaintenance, type MaintenanceMarker } from './maintenance';
import type { BackupCounts, BackupManifest } from './manifest';
import { BACKUP_WORK_PREFIX } from './paths';
import { backupFiles, listBackups, type BackupListItem } from './sidecar';

/*
 * Einspielen als Lauf (Spec Backup § Einspielen): Stand sichern · Backup prüfen · Bestand ersetzen · Datenbank anpassen
 * · Abschluss. Während des Austauschs liegt der Wartungsmerker (`maintenance.ts`), der Proxy sperrt jede Anfrage, die
 * Hintergrundarbeit steht. Der alte Bestand liegt bis zum Erfolg unter `DATA_PATH/.before-import-*` und wird bei einem
 * Fehler zurückgelegt; scheitert auch das, bleibt Kompass in Wartung, bis die Technik eingreift.
 */

/** Darf ein Agent einspielen? Kern-Einstellung, nur über die Oberfläche (`uiOnly`), Vorgabe aus (Spec § Agenten). */
export const BACKUP_HUMAN_ONLY_SETTING = 'backup.mcpHumanOnlyAllowed';

/**
 * Einstellungen, die zur Installation gehören und nicht zum Bestand: Beim Einspielen werden sie vor dem Ersetzen
 * gelesen und danach wieder geschrieben — sonst schaltete ein altes Backup die nächtlichen Backups still ab.
 */
export const INSTALLATION_SETTING_KEYS = [
  'backup.schedule.enabled',
  'backup.schedule.time',
  'backup.ring.daily',
  'backup.ring.weekly',
  'backup.ring.monthly',
  'backup.maxAgeDays',
  'backup.mcpHumanOnlyAllowed',
] as const;

/** Was zur Bestätigung eines Einspielens einzutippen ist. */
export function confirmationNameFor(env: AppEnv): string {
  return env === 'production' ? 'produktion' : env === 'test' ? 'test' : 'entwicklung';
}

export const restoreSchema = z.object({ name: z.string().min(1).max(200), confirmation: z.string() });
const previewSchema = z.object({ name: z.string().min(1).max(200) });

export interface RestoreResult {
  name: string;
  backupCreatedAt: string;
  /** Zeitpunkt des letzten Publizierens im Bestand **vor** dem Einspielen (Modul-Haken), sonst `null`. */
  lastPublishedAt: string | null;
  /** Ist die Webseite neuer als der eingespielte Stand? Dann zeigt die Backup-Seite einmal „Zum Publizieren“. */
  publishedSinceBackup: boolean;
}

export interface RestorePreview {
  name: string;
  /** Zeitpunkt des Bestands im Backup (Manifest), sonst der Datei. */
  createdAt: string;
  sizeBytes: number;
  /** Kurzer Name, falls festgehalten (Titel des Dialogs, Nachtrag Designer). */
  pinnedLabel: string | null;
  counts: BackupCounts | null;
  /** Protokolleinträge seit dem Zeitpunkt des Backups — was verloren ginge. */
  changesSince: number;
  /** Verschiedene Personen darunter (ohne Systemeinträge). */
  personsSince: number;
  estimatedSeconds: number;
  restorable: boolean;
}

const BEFORE_IMPORT = '.before-import-';
const pathMissing = (): Failure => localizedConflict('backupPathMissing', 'backup.errors.backupPathMissing');
const sourceOf = (ctx: CallContext): JobSource => (ctx.channel === 'mcp' ? 'mcp' : ctx.channel === 'system' ? 'system' : 'ui');
const findItem = (bp: string, name: string): BackupListItem | null => (backupFiles(bp, name) ? (listBackups(bp).find((i) => i.name === name) ?? null) : null);
/** Der Zeitpunkt des Bestands im Backup: aus dem Manifest, bei einem ungeprüften fremden Archiv aus der Datei. */
const createdAtOf = (item: BackupListItem): string => item.manifest?.createdAt ?? item.createdAt;
const restorableOf = (deps: AppDeps, item: BackupListItem): boolean =>
  item.manifest !== null && item.manifest.migrationCount <= deps.migrationCount && item.verification.status !== 'failed';

/** Lesbare Kennung `restore-<JJJJMMTT-HHmm>` in der Vereinszeitzone; die Wartungsseite zeigt sie der Technik. */
function restoreRunId(deps: AppDeps, bp: string): string {
  const tz = timeZoneOf(deps);
  const now = deps.clock.now();
  const base = `restore-${isoDayInZone(now, tz).replaceAll('-', '')}-${formatTime(now, tz).replace(':', '')}`;
  const last = readJobResult(backupJobSlot(bp), 'restore')?.runId;
  let id = base;
  for (let n = 2; id === last; n++) id = `${base}-${n}`;
  return id;
}

/** Geschätzte Dauer eines Einspielens. Prod-Export 641 MB in 68 s ≈ 9,4 MB/s; Einspielen ≈ Sichern plus Kopieren. */
export function estimateRestoreSeconds(sizeBytes: number): number {
  return Math.ceil((2 * sizeBytes) / (10 * 1024 * 1024)) + 10;
}

function launchRestore(deps: AppDeps, ctx: CallContext, bp: string, item: BackupListItem, setup: boolean): Result<JobStart> {
  const runId = restoreRunId(deps, bp);
  // Die Wartungsseite liest Person, Dauer, Zeitzone und Verein ohne Datenbank aus dem Lauf (Plan U1); `produceRestore`
  // setzt danach nur `name` neu, `setMeta` mischt.
  const meta = {
    name: item.name,
    backupCreatedAt: createdAtOf(item),
    startedBy: ctx.userId ? (userNamesFor(deps, [ctx.userId]).get(ctx.userId) ?? null) : null,
    estimatedSeconds: estimateRestoreSeconds(item.sizeBytes),
    timeZone: timeZoneOf(deps),
    organization: readSetting<string | null>(deps, 'organization.name') || null,
  };
  const started = launchJob(
    backupJobSlot(bp),
    deps.clock,
    { kind: 'restore', steps: BACKUP_JOB_STEPS.restore, source: sourceOf(ctx), userId: ctx.userId, apiTokenId: ctx.apiTokenId, runId, meta },
    (h) => produceRestore(deps, ctx, { name: item.name, setup, backupCreatedAt: meta.backupCreatedAt }, h),
  );
  if ('busy' in started) return ok({ started: false, running: started.busy });
  started.done.catch(() => undefined); // launchJob protokolliert den Fehler und schreibt ihn ins Ergebnis
  return ok({ started: true, runId: started.run.runId, startedAt: started.run.startedAt });
}

/**
 * Spielt ein Backup aus der Liste ein, im Hintergrund. Nur ein Mensch (`humanOnly`), Bestätigung durch den
 * Umgebungsnamen; ein laufender Webseiten-Lauf oder ein anderer Lauf im Hintergrund lehnt ab (`restoreBlocked`). Läuft schon ein Backup-Lauf, meldet er
 * ihn. „Einspielen gestartet“ steht im alten Bestand und damit im Backup „Vor Einspielen“.
 */
export async function startRestore(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<JobStart>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, BACKUP_HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, restoreSchema, input);
  if (!parsed.ok) return parsed;
  const { name, confirmation } = parsed.value;
  if (confirmation !== confirmationNameFor(deps.env)) return invalid([{ path: 'confirmation', message: 'confirmationMismatch' }]);
  if (!deps.backupPath) return pathMissing();
  const bp = deps.backupPath;
  const item = findItem(bp, name);
  if (!item) return notFound('backup', name);
  const reason = restoreHooks().busyReason() ?? otherJobReason(bp);
  if (reason) return localizedConflict('restoreBlocked', 'backup.errors.restoreBlocked', { reason });
  const running = runningJob(backupJobSlot(bp));
  if (running) return ok({ started: false, running });
  deps.db.transaction((tx) => recordAudit(tx, deps, ctx, { action: 'backup.restoreStart', entityType: 'backup', entityId: name, params: { createdAt: createdAtOf(item) } }));
  return launchRestore(deps, ctx, bp, item, false);
}

/**
 * Ein anderer Lauf im Hintergrund (Datenexport, Prüfpaket …) hält eigene Verbindungen und schreibt über `close()` und
 * `reopen()` hinweg weiter — nach dem Austausch in den neuen Bestand. Läufe des Backups selbst meldet `startRestore`
 * gesondert.
 */
function otherJobReason(bp: string): string | null {
  const own = backupJobSlot(bp).key;
  return activeJobSlotKeys().some((key) => key !== own) ? 'jobRunning' : null;
}

/** Ersteinrichtung aus einem Backup: ohne Anmeldung, ohne Sicherung, nur solange die Installation leer ist. */
export function startSetupRestore(deps: AppDeps, input: { name: string }): Result<JobStart> {
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  if (!deps.backupPath) return pathMissing();
  const item = findItem(deps.backupPath, input.name);
  if (!item) return notFound('backup', input.name);
  return launchRestore(deps, systemContext(), deps.backupPath, item, true);
}

/** Entfernt die Einträge (ohne Punkt) unter `dataPath` und legt den Inhalt der Rücklage zurück. */
function putAsideBack(dataPath: string, aside: string): void {
  for (const entry of readdirSync(dataPath)) if (!entry.startsWith('.')) rmSync(path.join(dataPath, entry), { recursive: true, force: true });
  for (const entry of readdirSync(aside)) renameSync(path.join(aside, entry), path.join(dataPath, entry));
}

async function produceRestore(deps: AppDeps, ctx: CallContext, opts: { name: string; setup: boolean; backupCreatedAt: string }, h: JobHandle): Promise<Result<RestoreResult>> {
  const bp = deps.backupPath!;
  const { name, setup } = opts;
  const runId = h.run.runId;
  const files = backupFiles(bp, name)!;

  // Der Wartungsmerker steht ab hier: Was nach dem Start geschrieben würde, fehlte im Backup „Vor Einspielen“ und ginge
  // mit dem Austausch verloren (Befundliste 0.4.0, I-E). Der Proxy sperrt Anfragen, `getDeps` hält MCP und Uploads an.
  // Endet der Lauf vor dem Austausch (Abbruch, Prüfung gescheitert), nimmt `finally` ihn wieder weg.
  let marker: MaintenanceMarker = { runId, since: isoNow(deps.clock), phase: 'safeguard', aside: null, backupName: name, backupCreatedAt: opts.backupCreatedAt, contact: null };
  writeMaintenance(bp, marker);
  let exchanging = false;
  try {
    const prepared = await safeguardAndVerify(deps, ctx, { name, setup }, h);
    if (!prepared.ok) return prepared;
    exchanging = true;
    marker = { ...marker, phase: 'prepare', backupCreatedAt: prepared.value.manifest.createdAt };
    return await exchange(deps, ctx, { name, setup, files, manifest: prepared.value.manifest, marker }, h);
  } finally {
    if (!exchanging) clearMaintenance(bp);
  }
}

async function safeguardAndVerify(deps: AppDeps, ctx: CallContext, opts: { name: string; setup: boolean }, h: JobHandle): Promise<Result<{ manifest: BackupManifest }>> {
  const { name, setup } = opts;
  // 1. Stand sichern — das Backup „Vor Einspielen“ ist der Weg zurück.
  if (setup) h.skip('safeguard');
  else {
    let made: Result<unknown>;
    try {
      made = await produceBackup(deps, ctx, 'preRestore', h, { database: 'safeguard', files: 'safeguard', verify: 'safeguard', prune: null });
    } catch (error) {
      if (error instanceof JobAbortedError) throw error;
      console.error('[jobs:restore] Sichern vor dem Einspielen gescheitert', error);
      made = localizedConflict('restoreSafeguardFailed', 'backup.errors.restoreSafeguardFailed');
    }
    h.setMeta({ name }); // produceBackup nennt im Lauf sein eigenes Backup
    if (!made.ok) return localizedConflict('restoreSafeguardFailed', 'backup.errors.restoreSafeguardFailed');
  }

  // 2. Backup prüfen.
  const verified = await produceVerification(deps, ctx, name, h, 'verify');
  if (!verified.ok) return verified;
  const manifest = verified.value.manifest!;
  if (manifest.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
  // Ohne Nutzer bliebe die Installation unbenutzbar und zugleich dauerhaft offen.
  if (setup && manifest.counts.users === 0) return invalid([{ path: 'archive', message: 'backupWithoutUsers' }]);
  return ok({ manifest });
}

async function exchange(
  deps: AppDeps,
  ctx: CallContext,
  opts: { name: string; setup: boolean; files: NonNullable<ReturnType<typeof backupFiles>>; manifest: BackupManifest; marker: MaintenanceMarker },
  h: JobHandle,
): Promise<Result<RestoreResult>> {
  const bp = deps.backupPath!;
  const dp = deps.dataPath;
  const { name, setup, files, manifest } = opts;
  const runId = h.run.runId;
  const backupCreatedAt = manifest.createdAt;

  // 3.–5. Ab hier kein Abbruch mehr; Wartung an, Hintergrund angehalten.
  h.setCancellable(false);
  const hooks = restoreHooks();
  let marker: MaintenanceMarker = opts.marker;
  writeMaintenance(bp, marker);
  const work = path.join(bp, `${BACKUP_WORK_PREFIX}${runId}-restore`);
  let closed = false;
  let stuck = false;
  let resumed = false;
  let step = 'replace';
  const resume = () => {
    if (resumed) return;
    resumed = true;
    hooks.resumeBackground();
  };
  try {
    await hooks.pauseBackground();
    const replaced = await runStep(h, 'replace', BACKUP_LIMITS.replace!, async () => {
      const keptTokens = deps.db.select().from(apiTokens).all();
      const keptSettings = INSTALLATION_SETTING_KEYS.filter((key) => deps.registry.settingDefinitions.has(key)).map((key) => [key, readSetting(deps, key)] as const);
      await mkdir(work, { recursive: true });
      const extracted = await extractBackup({ archivePath: files.archive, workDir: work });
      // Unmittelbar vor dem Austausch, nicht am Anfang: dazwischen soll möglichst nichts liegen.
      if (setup && !isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
      const published = lastPublishedAt(deps);
      const contact = readSetting<string | null>(deps, 'organization.email') || null;
      // Nur die jüngste Rücklage: zwei Generationen helfen niemandem und verdoppeln den Platzbedarf.
      for (const entry of await readdir(dp)) if (entry.startsWith(BEFORE_IMPORT)) await rm(path.join(dp, entry), { recursive: true, force: true });
      const aside = path.join(dp, `${BEFORE_IMPORT}${isoNow(deps.clock).replace(/[-:.]/g, '')}`);
      await mkdir(aside, { recursive: true });
      marker = { ...marker, phase: 'replace', aside, contact };
      writeMaintenance(bp, marker);
      deps.close();
      closed = true;
      for (const entry of await readdir(dp)) if (!entry.startsWith('.')) await rename(path.join(dp, entry), path.join(aside, entry));
      const restored = path.join(extracted, 'data');
      if (existsSync(restored)) await cp(restored, dp, { recursive: true });
      return ok({ keptTokens, keptSettings, published });
    });
    if (!replaced.ok) return replaced;
    const { keptTokens, keptSettings, published } = replaced.value;

    step = 'migrate';
    marker = { ...marker, phase: 'migrate' };
    writeMaintenance(bp, marker);
    await runStep(h, 'migrate', BACKUP_LIMITS.migrate!, async () => {
      deps.reopen();
      const sys = { ...systemContext(ctx.requestId), ipAddress: ctx.ipAddress };
      deps.db.transaction((tx) => {
        tx.delete(sessions).run();
        tx.delete(apiTokens).run();
        // Tokens gehören zur Installation: die geltenden bleiben, gesperrte bleiben gesperrt, ohne Nutzer entfallen sie.
        const known = new Set(tx.select({ id: users.id }).from(users).all().map((u) => u.id));
        for (const token of keptTokens) if (known.has(token.userId)) tx.insert(apiTokens).values(token).run();
        // Ein Eintrag fürs Einspielen statt einem je übernommener Einstellung (Prüfung 2026-10-23: zehn
        // `backup.import.mark`); die Schlüssel stehen darin, das Manifest ohne seine Dateiliste.
        const kept = [...keptSettings, ['system.lastImportAt', isoNow(deps.clock)], ['system.lastImportSource', `${manifest.environment} ${manifest.createdAt}`]] as const;
        for (const [key, value] of kept) writeSettingInternal(tx, deps, sys, key, value, null);
        const { files, ...rest } = manifest;
        const after = { ...rest, fileCount: files.length, keptSettings: kept.map(([key]) => key) };
        recordAudit(tx, deps, sys, { action: 'backup.import', entityType: 'backup', entityId: name, after, params: { environment: manifest.environment, createdAt: manifest.createdAt } });
      });
    });

    // Ab hier ist eingespielt. `done` vor dem Löschen der Rücklage: Ein Neustart mitten im Löschen legte sonst eine
    // halbe Rücklage über den neuen Bestand. Was danach scheitert, ist Aufräumen und macht das Einspielen nicht ungültig.
    step = 'finish';
    marker = { ...marker, phase: 'done' };
    writeMaintenance(bp, marker);
    try {
      await runStep(h, 'finish', BACKUP_LIMITS.finish!, async () => {
        if (marker.aside) await rm(marker.aside, { recursive: true, force: true });
        await rm(work, { recursive: true, force: true });
        clearMaintenance(bp);
        resume();
        await hooks.afterRestore();
        await pruneBackupRing(deps, systemContext());
      });
    } catch (error) {
      console.error('[jobs:restore] Eingespielt, Aufräumen danach gescheitert', error);
    }
    return ok({ name, backupCreatedAt, lastPublishedAt: published, publishedSinceBackup: published !== null && published > backupCreatedAt });
  } catch (error) {
    console.error(`[jobs:restore] Einspielen gescheitert im Schritt ${step}`, error);
    if (closed && step !== 'finish') {
      try {
        try {
          deps.close();
        } catch {
          // schon zu
        }
        putAsideBack(dp, marker.aside!);
        deps.reopen();
        rmSync(marker.aside!, { recursive: true, force: true });
      } catch (rollbackError) {
        stuck = true;
        writeMaintenance(bp, { ...marker, phase: 'rollbackFailed' });
        console.error(`[jobs:restore] Zurücklegen gescheitert; der vorige Bestand liegt unter ${marker.aside}`, rollbackError);
        return localizedConflict('restoreRollbackFailed', 'backup.errors.restoreRollbackFailed', { aside: marker.aside! });
      }
    }
    return localizedConflict('restoreFailed', 'backup.errors.restoreFailed', { step });
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (!stuck) {
      clearMaintenance(bp);
      resume();
    }
  }
}

/**
 * Beim Start, vor dem ersten Öffnen der Datenbank: Ein Neustart mitten im Austausch hinterlässt den Merker. Liegt der
 * alte Bestand schon beiseite, kommt er zurück; vorher war nichts angefasst. Ist das Zurücklegen schon einmal
 * gescheitert (oder scheitert es jetzt), bleibt Kompass in Wartung (`stuck`), bis die Technik den Merker entfernt.
 */
export function recoverInterruptedRestore(opts: { dataPath: string; backupPath: string }): 'none' | 'cleared' | 'rolledBack' | 'stuck' {
  const marker = readMaintenance(opts.backupPath);
  if (!marker) return 'none';
  if (marker.phase === 'rollbackFailed') return 'stuck';
  if (marker.phase === 'done') {
    // Eingespielt war schon; liegengeblieben ist nur die Rücklage.
    if (marker.aside) rmSync(marker.aside, { recursive: true, force: true });
    clearMaintenance(opts.backupPath);
    return 'cleared';
  }
  if (marker.phase === 'prepare' || marker.aside === null || !statSync(marker.aside, { throwIfNoEntry: false })?.isDirectory()) {
    clearMaintenance(opts.backupPath);
    return 'cleared';
  }
  try {
    putAsideBack(opts.dataPath, marker.aside);
    rmSync(marker.aside, { recursive: true, force: true });
  } catch (error) {
    console.error(`[kompass] Zurücklegen nach Neustart gescheitert; der vorige Bestand liegt unter ${marker.aside}`, error);
    writeMaintenance(opts.backupPath, { ...marker, phase: 'rollbackFailed' });
    return 'stuck';
  }
  clearMaintenance(opts.backupPath);
  return 'rolledBack';
}

/** Was ein Einspielen kostet: Änderungen und Personen seit dem Backup, seine Zählungen und die geschätzte Dauer. */
export async function restorePreview(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<RestorePreview>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  const parsed = validate(deps, previewSchema, input);
  if (!parsed.ok) return parsed;
  if (!deps.backupPath) return pathMissing();
  const item = findItem(deps.backupPath, parsed.value.name);
  if (!item) return notFound('backup', parsed.value.name);
  const createdAt = createdAtOf(item);
  const since = deps.db.select({ changes: count(), persons: countDistinct(auditLog.userId) }).from(auditLog).where(gt(auditLog.occurredAt, createdAt)).get();
  return ok({
    name: item.name,
    createdAt,
    sizeBytes: item.sizeBytes,
    pinnedLabel: item.pinnedLabel,
    counts: item.manifest?.counts ?? null,
    changesSince: since?.changes ?? 0,
    personsSince: since?.persons ?? 0,
    estimatedSeconds: estimateRestoreSeconds(item.sizeBytes),
    restorable: restorableOf(deps, item),
  });
}

