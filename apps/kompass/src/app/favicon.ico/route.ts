import { runtimeEnv } from '@/lib/deps';
import { iconPng } from '@/lib/env-icon-image';

/**
 * Safari fragt `/favicon.ico` ab, auch wenn die Seite Icons verlinkt. Ohne diese Route lief der Pfad auf die
 * Anmeldung (307 → /login), Safari merkte sich „kein Icon“ und zeigte eine Ersatzkachel (Joe 2026-10-11).
 * Ein PNG unter dieser Adresse nehmen alle Browser an.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return iconPng(runtimeEnv().env, 64, true);
}
