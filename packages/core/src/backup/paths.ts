import { statSync } from 'node:fs';
import path from 'node:path';

/**
 * Präfix für Arbeitsdateien im Backup-Verzeichnis (Datenbank-Kopie, halbes
 * Archiv). Die Liste überspringt Punktdateien, das Aufräumen erkennt sie daran.
 */
export const BACKUP_WORK_PREFIX = '.work-';

/**
 * `BACKUP_PATH` darf nie in `DATA_PATH` liegen (auch nicht gleich sein): Sonst
 * trüge jedes Backup die vorigen mit. Der Start bricht deshalb ab.
 */
export function assertBackupPathOutsideData(backupPath: string, dataPath: string): void {
  const backup = path.resolve(backupPath);
  const data = path.resolve(dataPath);
  const rel = path.relative(data, backup);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`BACKUP_PATH liegt in DATA_PATH: ${backup} (DATA_PATH ${data})`);
  }
}

export type BackupMountWarning = 'notMounted' | null;

/**
 * Nur im Image: Liegt `BACKUP_PATH` auf demselben Datenträger wie die Wurzel
 * des Containers, fehlt vermutlich der Mount, und die Backups gingen beim
 * nächsten Neuerstellen des Containers verloren. Der Start geht weiter, die
 * Warnung zeigen Seite und Kachel. Ein fehlendes Verzeichnis ist hier kein
 * Fall — das meldet die Prüfung des Verzeichnisses als Fehler.
 */
export function backupMountWarning(backupPath: string, opts: { inImage: boolean; rootPath?: string }): BackupMountWarning {
  if (!opts.inImage) return null;
  const backup = statSync(backupPath, { throwIfNoEntry: false });
  if (!backup) return null;
  const root = statSync(opts.rootPath ?? '/', { throwIfNoEntry: false });
  if (!root) return null;
  return backup.dev === root.dev ? 'notMounted' : null;
}
