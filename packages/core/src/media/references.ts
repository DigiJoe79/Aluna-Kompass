import { eq } from 'drizzle-orm';
import type { Deps } from '../deps';
import type { MediaReference } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { readSetting } from '../settings/service';

/**
 * Die Fundstellen im Kern selbst: das Logo. Projektbilder meldet das Modul `projects`. Gerenderte Dokumente
 * lebten hier, bis die Akte ins Modul `dms` zog — das Modul beantwortet sie
 * seither über seinen eigenen `mediaReferences`-Haken.
 */
export function coreMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const refs: MediaReference[] = [];

  if (readSetting<string | null>(deps, 'branding.logoAssetId') === assetId) {
    refs.push({ label: 'Logo des Vereins', entity: 'setting', id: 'branding.logoAssetId' });
  }
  return refs;
}

/**
 * Alle Verweise auf ein Asset — Kern plus jedes **aktive** Modul.
 * `enabledManifests` enthält `coreModule`, dessen `mediaReferences` auf
 * `coreMediaReferences` zeigt. Ein deaktiviertes Modul steht nicht in der Liste
 * und wird nicht befragt.
 */
export function findMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return enabledManifests(deps).flatMap((m) => m.mediaReferences?.(deps, assetId) ?? []);
}
