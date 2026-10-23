import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { databasePathIn, type AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { systemContext } from '../context';
import { isoDayInZone } from '../dates';
import type { AppEnv } from '../deps';
import { DEFAULT_TIME_ZONE } from '../today';
import { removeBackupFiles } from './create';
import { clearBackupProblem } from './notify';
import { planRetention } from './ring';
import { backupFiles, backupFileName, listBackups, uniqueBackupName, writeSidecar, type BackupSidecar } from './sidecar';
import { updateBackupState, type BackupProblemCode } from './state';
import { verifyBackupArchive } from './verify';
import { createBackupArchive, type BackupSource } from './write';

/*
 * Backup vor Update (Spec Backup § Backup vor Update): beim Start, nur wenn Migrationen anstehen, bevor sie laufen —
 * auf einer eigenen, nur lesenden Öffnung der Datenbank, vor dem ersten `getDeps`. Scheitert es, startet Kompass nicht.
 */

const hasMigrationTable = (sqlite: Database.Database) =>
  sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get() !== undefined;

const appliedMigrations = (sqlite: Database.Database) => (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;

/** Einträge im Journal minus angewandte Migrationen; Datei oder Tabelle fehlt (frische Installation) → 0. */
export function pendingMigrationCount(databasePath: string, migrationsFolder: string): number {
  if (!existsSync(databasePath)) return 0;
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (!hasMigrationTable(sqlite)) return 0;
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    return Math.max(0, journal.entries.length - appliedMigrations(sqlite));
  } finally {
    sqlite.close();
  }
}

class PreUpdateError extends Error {
  constructor(
    readonly code: Extract<BackupProblemCode, 'preUpdateFailed' | 'backupPathUnwritable'>,
    message: string,
    readonly backupName: string | null = null,
  ) {
    super(message);
  }
}

/**
 * Sichert die Installation als Art `preUpdate`, prüft das Archiv und räumt Backups dieser Art nach 30 Tagen auf (das
 * neueste geprüfte bleibt). Wirft bei jedem Scheitern und merkt den Fehler mit `mailed: false` — die Mail schickt
 * `checkBackupHealth` beim nächsten Start, der durchläuft; vor dem Start gibt es keinen Versandweg.
 */
export async function runPreUpdateBackup(opts: {
  dataPath: string;
  backupPath: string;
  env: AppEnv;
  appVersion: string;
  migrationsFolder: string;
  now: Date;
}): Promise<{ status: 'notNeeded' } | { status: 'done'; sidecar: BackupSidecar }> {
  const databasePath = databasePathIn(opts.dataPath);
  if (pendingMigrationCount(databasePath, opts.migrationsFolder) === 0) return { status: 'notNeeded' };
  const bp = path.resolve(opts.backupPath);
  try {
    try {
      mkdirSync(bp, { recursive: true });
      accessSync(bp, constants.W_OK);
    } catch {
      throw new PreUpdateError('backupPathUnwritable', `backupPathUnwritable: ${bp}`);
    }
    return { status: 'done', sidecar: await backupAndVerify(databasePath, bp, opts) };
  } catch (error) {
    const known = error instanceof PreUpdateError ? error : null;
    try {
      updateBackupState(bp, {
        lastError: {
          code: known?.code ?? 'preUpdateFailed',
          at: opts.now.toISOString(),
          kind: 'preUpdate',
          name: known?.backupName ?? null,
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          mailed: false,
        },
      });
    } catch {
      // Nicht beschreibbar: Das Log nennt den Grund, die Seite kann ihn nicht zeigen.
    }
    throw error;
  }
}

async function backupAndVerify(databasePath: string, bp: string, opts: { dataPath: string; env: AppEnv; appVersion: string; now: Date }): Promise<BackupSidecar> {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const source: BackupSource = {
      dataPath: opts.dataPath,
      env: opts.env,
      appVersion: opts.appVersion,
      migrationCount: appliedMigrations(sqlite),
      backupDatabase: (destination) => sqlite.backup(destination).then(() => undefined),
      // Modul-Zählungen brauchen ein geöffnetes Deps-Objekt, das es vor der Migration nicht gibt.
      moduleCounts: () => ({}),
    };
    const createdAt = opts.now.toISOString();
    const name = uniqueBackupName(bp, backupFileName(opts.env, createdAt, 'preUpdate'));
    const files = backupFiles(bp, name)!;
    const written = await createBackupArchive(source, { archivePath: files.archive, workDir: bp, createdAt });
    const base: BackupSidecar = {
      version: 1,
      name,
      kind: 'preUpdate',
      createdAt,
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      manifest: written.manifest,
      verification: { status: 'unverified' },
      pinned: false,
      pinnedLabel: null,
    };
    writeSidecar(bp, base);
    const outcome = await verifyBackupArchive(files.archive, { workDir: bp, expectedSha256: written.sha256 });
    const at = opts.now.toISOString();
    if (!outcome.ok) {
      writeSidecar(bp, { ...base, verification: { status: 'failed', at, reason: outcome.reason } });
      throw new PreUpdateError('preUpdateFailed', `backupVerifyFailed: ${outcome.reason}`, name);
    }
    const sidecar: BackupSidecar = { ...base, verification: { status: 'passed', at } };
    writeSidecar(bp, sidecar);
    // Ring und Zeitzone stehen in der Datenbank, die hier noch nicht offen ist; die 30-Tage-Regel hängt am Ring nicht.
    const plan = planRetention(listBackups(bp).filter((i) => i.kind === 'preUpdate'), { daily: 0, weekly: 0, monthly: 0 }, DEFAULT_TIME_ZONE, isoDayInZone(opts.now, DEFAULT_TIME_ZONE));
    removeBackupFiles(bp, [...plan.entries()].filter(([, r]) => r.kind === 'prune').map(([n]) => n));
    return sidecar;
  } finally {
    sqlite.close();
  }
}

/** Nach dem Start mit offener Datenbank: Protokoll `backup.create` als System, und der letzte Fehler ist erledigt. */
export function recordPreUpdateBackup(deps: AppDeps, sidecar: BackupSidecar): void {
  deps.db.transaction((tx) =>
    recordAudit(tx, deps, systemContext('pre-update'), { action: 'backup.create', entityType: 'backup', entityId: sidecar.name, params: { kind: 'preUpdate', sizeBytes: sidecar.sizeBytes } }),
  );
  if (deps.backupPath) clearBackupProblem(deps.backupPath);
}
