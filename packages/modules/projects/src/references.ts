import type { AssetMediaReference, Deps } from '@kompass/core';
import { isNotNull } from 'drizzle-orm';
import { projects } from './schema';

/** Wo Bilder in Projekten hängen — für „Wird verwendet in“ der Mediathek. Eine Abfrage für alle Assets. */
export function projectsMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  return deps.db
    .select({ id: projects.id, slug: projects.slug, assetId: projects.imageAssetId })
    .from(projects)
    .where(isNotNull(projects.imageAssetId))
    .all()
    .filter((p) => assetIds.has(p.assetId!))
    .map((p) => ({ assetId: p.assetId!, label: `Projekt „${p.slug}“`, entity: 'project', id: p.id, href: `/projects/${p.id}` }));
}
