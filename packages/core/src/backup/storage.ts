import fs from 'node:fs';
import { listBackups, type BackupListItem } from './sidecar';

/**
 * Speicherplatz für Backups (Spec Backup § Liste und Download): belegt von Backups, frei und gesamt auf dem Datenträger
 * von `BACKUP_PATH`, und die Vorwarnung, wenn der freie Platz nicht mehr für **zwei** weitere Backups der Größe des
 * neuesten geprüften reicht. `fs` über das Standardobjekt, damit Tests `statfs` ersetzen können.
 */
export interface BackupStorage {
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
  /** Größe des neuesten geprüften Backups — der Maßstab der Vorwarnung; ohne geprüftes `null`. */
  referenceBytes: number | null;
  low: boolean;
}

/** Wie viele Backups der heutigen Größe noch Platz haben müssen, damit nicht gewarnt wird. */
export const BACKUP_STORAGE_RESERVE = 2;

function storageOf(items: readonly BackupListItem[], stats: { bavail: number | bigint; bsize: number | bigint; blocks: number | bigint }): BackupStorage {
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const usedBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const reference = items.find((item) => item.verification.status === 'passed')?.sizeBytes ?? null;
  return { usedBytes, freeBytes, totalBytes, referenceBytes: reference, low: reference !== null && freeBytes < BACKUP_STORAGE_RESERVE * reference };
}

/** `null`, wenn das Verzeichnis fehlt oder sich nicht befragen lässt. */
export async function backupStorage(backupPath: string): Promise<BackupStorage | null> {
  try {
    const stats = await fs.promises.statfs(backupPath);
    return storageOf(listBackups(backupPath), stats);
  } catch {
    return null;
  }
}

export function backupStorageSync(backupPath: string): BackupStorage | null {
  try {
    const stats = fs.statfsSync(backupPath);
    return storageOf(listBackups(backupPath), stats);
  } catch {
    return null;
  }
}
