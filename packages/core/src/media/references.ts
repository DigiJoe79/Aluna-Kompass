import type { Deps } from '../deps';
import type { AssetMediaReference, MediaReference } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { readSetting } from '../settings/service';

/**
 * Die Fundstellen im Kern selbst: das Logo. Projektbilder meldet das Modul `projects`. Gerenderte Dokumente
 * lebten hier, bis die Akte ins Modul `dms` zog — das Modul beantwortet sie
 * seither über seinen eigenen `mediaReferences`-Haken.
 */
export function coreMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  const logo = readSetting<string | null>(deps, 'branding.logoAssetId');
  if (!logo || !assetIds.has(logo)) return [];
  return [{ assetId: logo, label: 'Logo des Vereins', entity: 'setting', id: 'branding.logoAssetId', href: '/admin/settings' }];
}

/**
 * Alle Verweise auf eine Menge von Assets — Kern plus jedes **aktive** Modul,
 * jedes genau einmal für die ganze Menge. Jedes Asset steht in der Antwort,
 * auch ohne Fund. `enabledManifests` enthält `coreModule`, dessen
 * `mediaReferences` auf `coreMediaReferences` zeigt. Ein deaktiviertes Modul
 * steht nicht in der Liste und wird nicht befragt.
 */
export function findMediaReferencesFor(deps: Deps, assetIds: Iterable<string>): Map<string, MediaReference[]> {
  const ids = new Set(assetIds);
  const found = new Map<string, MediaReference[]>([...ids].map((id) => [id, []]));
  if (ids.size === 0) return found;
  for (const manifest of enabledManifests(deps)) {
    for (const { assetId, ...reference } of manifest.mediaReferences?.(deps, ids) ?? []) found.get(assetId)?.push(reference);
  }
  return found;
}

/** Alle Verweise auf ein Asset. */
export function findMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return findMediaReferencesFor(deps, [assetId]).get(assetId) ?? [];
}
