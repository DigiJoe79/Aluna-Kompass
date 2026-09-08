import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Leert ein Verzeichnis, statt es zu entfernen.
 *
 * Im Container ist das Medienverzeichnis ein Einhängepunkt: Ein `rm` darauf
 * scheitert mit EACCES, und der Rücksetzpfad der E2E-Tests brach ab, bevor er
 * etwas tun konnte. Sichtbar wurde das erst, als dieselbe Suite gegen das
 * gebaute Image lief.
 */
export function clearDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) rmSync(path.join(dir, entry), { recursive: true, force: true });
}
