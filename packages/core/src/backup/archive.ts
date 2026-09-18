import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';

/** Obergrenze fuer die entpackte Gesamtgroesse. Ohne sie genuegt ein kleines
 *  Archiv, um die Platte zu fuellen. */
export const BACKUP_MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;

export class BackupTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Das Archiv entpackt sich auf mehr als ${Math.round(limitBytes / 1024 / 1024 / 1024)} GB`);
    this.name = 'BackupTooLargeError';
  }
}

// Zwei Eintraege: das Manifest und ein Abbild von `dataPath`. Alles, was ein
// Modul dort ablegt, ist damit ohne weiteres Zutun im Backup — genau dafuer
// liegt es unter `dataPath` und nicht daneben. `data` selbst gehoert dazu,
// sonst entstuende das Verzeichnis bei einem leeren Bestand gar nicht.
const ALLOWED = /^(manifest\.json|data(\/.*)?)$/;

/**
 * Alles andere wird beim Entpacken verworfen — ausdruecklich, statt sich auf
 * die Voreinstellung von node-tar zu verlassen, die sich in einer neuen
 * Fassung aendern koennte.
 */
export function isAllowedBackupEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/^\.\//, '');
  if (normalized.startsWith('/')) return false;
  if (normalized.split('/').includes('..')) return false;
  return ALLOWED.test(normalized);
}

export async function extractBackup(opts: {
  archivePath: string;
  workDir: string;
  maxBytes?: number;
}): Promise<string> {
  const limit = opts.maxBytes ?? BACKUP_MAX_UNPACKED_BYTES;
  const dir = await mkdtemp(path.join(opts.workDir, 'kompass-import-'));
  let unpacked = 0;
  let exceeded = false;
  await tar.extract({
    file: opts.archivePath,
    cwd: dir,
    // Aus dem Filter darf nicht geworfen werden: tar 7.5 reicht den Fehler
    // nicht als abgelehntes Promise weiter, er entkommt synchron durch den
    // Ereignis-Emitter und beendet den Prozess. Ein absichtlich zu grosses
    // Archiv waere damit ein Denial-of-Service statt einer abgelehnten Datei.
    // Deshalb ab der Grenze nichts mehr schreiben und danach werfen.
    filter: (entryPath, entry) => {
      if (exceeded || !isAllowedBackupEntry(entryPath)) return false;
      unpacked += entry.size;
      if (unpacked > limit) {
        exceeded = true;
        return false;
      }
      return true;
    },
  });
  if (exceeded) {
    await rm(dir, { recursive: true, force: true });
    throw new BackupTooLargeError(limit);
  }
  return dir;
}
