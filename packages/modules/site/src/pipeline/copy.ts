import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Kopiert einen Verzeichnisbaum ueber gewoehnliches Lesen und Schreiben.
 *
 * Bewusst nicht `fs.cp`: das nutzt unter Linux `copy_file_range`, was ueber
 * Dateisystemgrenzen hinweg — im Container von /tmp auf das gemountete
 * Datenvolume — je nach Kernel und Dateisystem 0 statt eines Fehlers liefern
 * kann. Die Kopierschleife dreht dann endlos ohne Fortschritt und ohne
 * Fehlermeldung, mit einem dauerhaft belegten Worker im Threadpool.
 */
export async function copyTree(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isSymbolicLink()) {
      await symlink(await readlink(from), to).catch(() => undefined);
    } else if (entry.isFile()) {
      await pipeline(createReadStream(from), createWriteStream(to));
    }
  }
}
