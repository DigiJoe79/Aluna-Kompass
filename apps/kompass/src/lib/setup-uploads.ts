import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

/** Obergrenze fuer den Upload. Der Endpunkt ist ohne Anmeldung erreichbar. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Neben der Datenbank, nicht in /tmp: gleiches Dateisystem wie das Ziel, und
 * ein angefangener Upload ueberlebt keinen Containerneustart im Abbild.
 */
export function uploadsDir(databasePath: string): string {
  return path.join(path.dirname(databasePath), 'uploads');
}

export function isUploadHandle(value: string): boolean {
  return ULID.test(value);
}

/**
 * Prueft die Kennung, bevor sie zu einem Pfad wird, und stellt sicher, dass der
 * aufgeloeste Pfad in der Ablage liegt. Null heisst: nicht anfassen.
 */
export function resolveUpload(databasePath: string, handle: string): string | null {
  if (!isUploadHandle(handle)) return null;
  const dir = path.resolve(uploadsDir(databasePath));
  const file = path.resolve(path.join(dir, `${handle}.tar.gz`));
  return file.startsWith(`${dir}${path.sep}`) ? file : null;
}

/** Leert die Ablage und gibt ihren Pfad zurueck. */
export async function clearUploads(databasePath: string): Promise<string> {
  const dir = uploadsDir(databasePath);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}
