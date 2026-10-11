import { nameOrEmpty, readLocales, type AssetMediaReference, type Deps, type LocalizedText } from '@kompass/core';
import { isNotNull } from 'drizzle-orm';
import { projects } from './schema';

/** Wo Bilder in Projekten hängen — für „Wird verwendet in“ der Mediathek. Eine Abfrage für alle Assets. */
export function projectsMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  const leading = readLocales(deps)[0]!;
  return deps.db
    .select({ id: projects.id, slug: projects.slug, name: projects.name, assetId: projects.imageAssetId, crop: projects.imageCrop })
    .from(projects)
    .where(isNotNull(projects.imageAssetId))
    .all()
    .filter((p) => assetIds.has(p.assetId!))
    .map((p) => {
      // Stufe 1, Auftrag 6: der Name in der Leitsprache wie bei Tieren, nie der Slug.
      const name = nameOrEmpty((p.name as LocalizedText)[leading]);
      return { assetId: p.assetId!, label: `Projekt „${name}“`, entity: 'project', id: p.id, href: `/projects/${p.id}`, cropped: !!p.crop };
    });
}
