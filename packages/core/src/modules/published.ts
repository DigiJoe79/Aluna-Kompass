import type { Deps } from '../deps';
import { enabledManifests } from './service';

/**
 * Wann zuletzt publiziert wurde — der größte Wert, den ein eingeschaltetes Modul über `lastPublishedAt` meldet; ohne
 * solches Modul `null`. Der Kern liest keine Webseiten-Tabellen (Prinzip 1).
 */
export function lastPublishedAt(deps: Deps): string | null {
  let latest: string | null = null;
  for (const manifest of enabledManifests(deps)) {
    const at = manifest.lastPublishedAt?.(deps) ?? null;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}
