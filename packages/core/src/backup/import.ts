import { cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { isSetupRequired } from '../setup/service';
import { loadUserSummary } from '../users/service';
import { validate } from '../validate';
import { extractBackup } from './archive';
import { DB_RELATIVE } from './export';
import { backupManifestSchema, type BackupManifest } from './manifest';

async function readManifest(dir: string): Promise<Result<BackupManifest>> {
  const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => null);
  if (raw === null) return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]); }
  const parsed = backupManifestSchema.safeParse(json);
  return parsed.success ? ok(parsed.data) : invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
}

export async function inspectBackup(opts: { archivePath: string; workDir: string }): Promise<Result<BackupManifest>> {
  const dir = await extractBackup({ archivePath: opts.archivePath, workDir: opts.workDir });
  try { return await readManifest(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const importSchema = z.object({ archivePath: z.string().min(1), workDir: z.string().min(1), confirmation: z.string(), environmentName: z.string().min(1) });


/**
 * Der zerstoerende Teil beider Importwege: Datenbank schliessen, Bestand
 * beiseitelegen, ersetzen, wieder oeffnen, protokollieren. Steht bewusst nur
 * einmal im Code — sonst muesste die Zugangsbedingung an zwei Stellen richtig
 * sein.
 */
async function applyBackup(
  deps: AppDeps,
  dir: string,
  manifest: BackupManifest,
  opts: { archiveName: string; ctx: CallContext; importerEmail: string | null; onlyWhileSetupPending: boolean },
): Promise<Result<{ manifest: BackupManifest }>> {
  // Unmittelbar vor dem Austausch, nicht am Anfang: dazwischen soll
  // moeglichst nichts liegen.
  if (opts.onlyWhileSetupPending && !isSetupRequired(deps)) {
    return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  }
  deps.close();
  // `dataPath` ist der Einhaengepunkt, alles darunter sind gewoehnliche
  // Verzeichnisse. Der ganze Bestand wandert deshalb in einem Zug zur Seite,
  // statt wie frueher innerhalb jedes einzelnen Speichers gearbeitet werden
  // zu muessen.
  const aside = path.join(deps.dataPath, `.before-import-${isoNow(deps.clock).replace(/[-:.]/g, '')}`);
  await mkdir(deps.dataPath, { recursive: true });
  for (const entry of await readdir(deps.dataPath)) {
    // Nur die juengste Rueckfahrkarte wird aufgehoben: zwei Generationen
    // helfen niemandem und verdoppeln den Platzbedarf bei jedem Versuch.
    if (entry.startsWith('.before-import-')) await rm(path.join(deps.dataPath, entry), { recursive: true, force: true });
  }
  await mkdir(aside, { recursive: true });
  for (const entry of await readdir(deps.dataPath)) {
    if (entry.startsWith('.before-import-')) continue;
    await rename(path.join(deps.dataPath, entry), path.join(aside, entry));
  }
  const restored = path.join(dir, 'data');
  if (await stat(restored).catch(() => null)) {
    await cp(restored, deps.dataPath, { recursive: true });
  }
  deps.reopen();

  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    const sys = { ...systemContext(opts.ctx.requestId), ipAddress: opts.ctx.ipAddress };
    writeSettingInternal(tx, deps, sys, 'system.lastImportAt', now, 'backup.import.mark');
    writeSettingInternal(tx, deps, sys, 'system.lastImportSource', `${manifest.environment} ${manifest.createdAt}`, 'backup.import.mark');
    recordAudit(tx, deps, sys, {
      action: 'backup.import',
      entityType: 'backup',
      entityId: opts.archiveName,
      after: manifest,
      summary: `Bestand aus Backup (${manifest.environment}, ${manifest.createdAt}) importiert durch ${opts.importerEmail ?? 'unbekannt'}`,
    });
  });
  return ok({ manifest });
}

export async function importBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ manifest: BackupManifest }>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  const parsed = validate(deps, importSchema, input);
  if (!parsed.ok) return parsed;
  const { archivePath, workDir, confirmation, environmentName } = parsed.value;
  if (confirmation !== environmentName) return invalid([{ path: 'confirmation', message: 'confirmationMismatch' }]);
  const dir = await extractBackup({ archivePath, workDir });
  try {
    const manifest = await readManifest(dir);
    if (!manifest.ok) return manifest;
    if (manifest.value.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
    const dbFile = path.join(dir, 'data', ...DB_RELATIVE);
    if (!(await stat(dbFile).catch(() => null))) return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    const probe = new Database(dbFile, { readonly: true });
    const integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
    probe.close();
    if (integrity !== 'ok') return invalid([{ path: 'archive', message: 'backupCorrupt' }]);

    const importer = ctx.userId ? loadUserSummary(deps.db, ctx.userId) : null;
    return await applyBackup(deps, dir, manifest.value, {
      archiveName: path.basename(archivePath),
      ctx,
      importerEmail: importer?.email ?? null,
      onlyWhileSetupPending: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const setupImportSchema = z.object({ archivePath: z.string().min(1), workDir: z.string().min(1) });

/**
 * Import ohne Anmeldung, ausschliesslich solange die Einrichtung aussteht.
 * Kein CallContext und keine Rechtepruefung: es gibt keinen Nutzer, dem Rechte
 * gehoeren koennten. Die Bedingung prueft applyBackup unmittelbar vor dem
 * Austausch noch einmal.
 */
export async function importBackupForSetup(deps: AppDeps, input: unknown): Promise<Result<{ manifest: BackupManifest }>> {
  const parsed = validate(deps, setupImportSchema, input);
  if (!parsed.ok) return parsed;
  if (!isSetupRequired(deps)) return conflict('setupAlreadyDone', 'Die Einrichtung wurde bereits abgeschlossen');
  const { archivePath, workDir } = parsed.value;
  const dir = await extractBackup({ archivePath, workDir });
  try {
    const manifest = await readManifest(dir);
    if (!manifest.ok) return manifest;
    if (manifest.value.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
    // Ohne Nutzer bliebe die Installation unbenutzbar und zugleich dauerhaft
    // offen: niemand koennte sich anmelden, der Endpunkt bliebe erreichbar.
    if (manifest.value.counts.users === 0) return invalid([{ path: 'archive', message: 'backupWithoutUsers' }]);
    const dbFile = path.join(dir, 'data', ...DB_RELATIVE);
    if (!(await stat(dbFile).catch(() => null))) return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    const probe = new Database(dbFile, { readonly: true });
    const integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
    probe.close();
    if (integrity !== 'ok') return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    return await applyBackup(deps, dir, manifest.value, {
      archiveName: path.basename(archivePath),
      ctx: systemContext(),
      importerEmail: null,
      onlyWhileSetupPending: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
