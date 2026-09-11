import { eq } from 'drizzle-orm';
import { projects } from '../db/schema';
import type { Deps } from '../deps';
import type { MediaReference } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { readSetting } from '../settings/service';

/**
 * Die Fundstellen im Kern selbst: Logo, Projektbilder. Gerenderte Dokumente
 * lebten hier, bis die Akte ins Modul `dms` zog — das Modul beantwortet sie
 * seither über seinen eigenen `mediaReferences`-Haken.
 */
export function coreMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const refs: MediaReference[] = [];

  if (readSetting<string | null>(deps, 'branding.logoAssetId') === assetId) {
    refs.push({ label: 'Logo des Vereins', entity: 'setting', id: 'branding.logoAssetId' });
  }
  for (const p of deps.db.select({ id: projects.id, slug: projects.slug }).from(projects).where(eq(projects.imageAssetId, assetId)).all()) {
    refs.push({ label: `Projekt „${p.slug}“`, entity: 'project', id: p.id });
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
