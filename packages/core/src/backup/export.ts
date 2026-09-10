import { count } from 'drizzle-orm';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as tar from 'tar';
import type { AppDeps } from '../app';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import { systemContext, type CallContext } from '../context';
import { auditLog, mediaAssets, users } from '../db/schema';
import { requirePermission } from '../permissions/check';
import { ok, type Result } from '../result';
import { writeSettingInternal } from '../settings/service';
import { BACKUP_FORMAT, type BackupManifest } from './manifest';

export const APP_VERSION = '0.1.0';

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function exportBackup(deps: AppDeps, ctx: CallContext, opts: { workDir: string }): Promise<Result<{ archivePath: string; bytes: number; manifest: BackupManifest }>> {
  const denied = requirePermission(ctx, 'backup.export');
  if (denied) return denied;
  const now = isoNow(deps.clock);
  const staging = await mkdtemp(path.join(opts.workDir, 'kompass-export-'));
  try {
    const dbCopy = path.join(staging, 'kompass.db');
    await deps.backupDatabase(dbCopy);
    const copy = new Database(dbCopy);
    copy.exec('delete from sessions; delete from api_tokens; vacuum;');
    copy.close();
    await mkdir(path.join(staging, 'media'), { recursive: true });
    if (deps.media.rootDir && (await stat(deps.media.rootDir).catch(() => null))) {
      await cp(deps.media.rootDir, path.join(staging, 'media'), { recursive: true });
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      appVersion: APP_VERSION,
      createdAt: now,
      environment: deps.env,
      migrationCount: deps.migrationCount,
      counts: {
        users: deps.db.select({ n: count() }).from(users).get()?.n ?? 0,
        auditEntries: deps.db.select({ n: count() }).from(auditLog).get()?.n ?? 0,
        mediaAssets: deps.db.select({ n: count() }).from(mediaAssets).get()?.n ?? 0,
      },
    };
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const archivePath = path.join(opts.workDir, `kompass-backup-${deps.env}-${stamp(now)}.tar.gz`);
    await tar.create({ gzip: true, cwd: staging, file: archivePath, portable: true }, ['manifest.json', 'kompass.db', 'media']);
    const bytes = (await stat(archivePath)).size;
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, systemContext(ctx.requestId), 'system.lastExportAt', now, 'backup.export.mark');
      recordAudit(tx, deps, ctx, { action: 'backup.export', entityType: 'backup', entityId: path.basename(archivePath), after: manifest, summary: `Backup exportiert (${Math.round(bytes / 1024)} KB)` });
    });
    return ok({ archivePath, bytes, manifest });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
