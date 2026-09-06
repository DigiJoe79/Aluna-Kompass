import { cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { requirePermission } from '../permissions/check';
import { invalid, ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { loadUserSummary } from '../users/service';
import { validate } from '../validate';
import { extractBackup } from './archive';
import { backupManifestSchema, type BackupManifest } from './manifest';

async function readManifest(dir: string): Promise<Result<BackupManifest>> {
  const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => null);
  if (raw === null) return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]); }
  const parsed = validate(backupManifestSchema, json);
  return parsed.ok ? parsed : invalid([{ path: 'archive', message: 'backupFormatUnsupported' }]);
}

export async function inspectBackup(opts: { archivePath: string; workDir: string }): Promise<Result<BackupManifest>> {
  const dir = await extractBackup({ archivePath: opts.archivePath, workDir: opts.workDir });
  try { return await readManifest(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const importSchema = z.object({ archivePath: z.string().min(1), workDir: z.string().min(1), confirmation: z.string(), environmentName: z.string().min(1) });

export async function importBackup(deps: AppDeps, ctx: CallContext, input: unknown): Promise<Result<{ manifest: BackupManifest }>> {
  const denied = requirePermission(ctx, 'backup.import');
  if (denied) return denied;
  const parsed = validate(importSchema, input);
  if (!parsed.ok) return parsed;
  const { archivePath, workDir, confirmation, environmentName } = parsed.value;
  if (confirmation !== environmentName) return invalid([{ path: 'confirmation', message: 'confirmationMismatch' }]);
  const dir = await extractBackup({ archivePath, workDir });
  try {
    const manifest = await readManifest(dir);
    if (!manifest.ok) return manifest;
    if (manifest.value.migrationCount > deps.migrationCount) return invalid([{ path: 'archive', message: 'backupNewerThanApp' }]);
    const dbFile = path.join(dir, 'kompass.db');
    if (!(await stat(dbFile).catch(() => null))) return invalid([{ path: 'archive', message: 'backupCorrupt' }]);
    const probe = new Database(dbFile, { readonly: true });
    const integrity = (probe.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
    probe.close();
    if (integrity !== 'ok') return invalid([{ path: 'archive', message: 'backupCorrupt' }]);

    const importer = ctx.userId ? loadUserSummary(deps.db, ctx.userId) : null;
    const stampSuffix = `.before-import-${isoNow(deps.clock).replace(/[-:.]/g, '')}`;
    deps.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${deps.databasePath}${suffix}`;
      if (await stat(file).catch(() => null)) await rename(file, `${file}${stampSuffix}`);
    }
    await cp(dbFile, deps.databasePath);
    if (deps.media.rootDir) {
      const root = deps.media.rootDir;
      // Im Container ist das Medienverzeichnis ein Einhaengepunkt eines Volumes.
      // Ein Mountpoint laesst sich nicht umbenennen, und sein Elternverzeichnis
      // ist nicht beschreibbar — deshalb wird innerhalb gearbeitet: der alte
      // Bestand wandert in ein Unterverzeichnis, das der Medienspeicher nie
      // sieht, weil dessen Dateinamen mit [a-z0-9] beginnen muessen.
      await mkdir(root, { recursive: true });
      const aside = path.join(root, stampSuffix);
      await mkdir(aside, { recursive: true });
      for (const entry of await readdir(root)) {
        if (entry.startsWith('.before-import-')) continue;
        await rename(path.join(root, entry), path.join(aside, entry));
      }
      await cp(path.join(dir, 'media'), root, { recursive: true });
    }
    deps.reopen();

    const now = isoNow(deps.clock);
    deps.db.transaction((tx) => {
      const sys = { ...systemContext(ctx.requestId), ipAddress: ctx.ipAddress };
      writeSettingInternal(tx, deps, sys, 'system.lastImportAt', now, 'backup.import.mark');
      writeSettingInternal(tx, deps, sys, 'system.lastImportSource', `${manifest.value.environment} ${manifest.value.createdAt}`, 'backup.import.mark');
      recordAudit(tx, deps, sys, { action: 'backup.import', entityType: 'backup', entityId: path.basename(archivePath), after: manifest.value, summary: `Bestand aus Backup (${manifest.value.environment}, ${manifest.value.createdAt}) importiert durch ${importer?.email ?? 'unbekannt'}` });
    });
    return ok({ manifest: manifest.value });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
