import type { AssetMediaReference, Deps } from '@kompass/core';
import { animalPhotos, animals, animalStories } from './schema';

/**
 * Wo Assets als Tierfoto oder in einer Erfolgsgeschichte hängen. Liest die
 * Foto- und Geschichtstabelle je einmal ganz und filtert hier — beide sind
 * klein, und eine IN-Liste mit tausenden IDs stieße an SQLites Grenze.
 */
export function animalsMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  const pairs = new Set<string>();
  const hits: { assetId: string; animalId: string }[] = [];
  const add = (assetId: string | null, animalId: string) => {
    if (!assetId || !assetIds.has(assetId) || pairs.has(`${assetId}|${animalId}`)) return;
    pairs.add(`${assetId}|${animalId}`);
    hits.push({ assetId, animalId });
  };
  for (const r of deps.db.select({ assetId: animalPhotos.assetId, animalId: animalPhotos.animalId }).from(animalPhotos).all()) add(r.assetId, r.animalId);
  for (const r of deps.db
    .select({ before: animalStories.beforeAssetId, after: animalStories.afterAssetId, animalId: animalStories.animalId })
    .from(animalStories)
    .all()) {
    add(r.before, r.animalId);
    add(r.after, r.animalId);
  }
  if (hits.length === 0) return [];
  const names = new Map(deps.db.select({ id: animals.id, name: animals.name }).from(animals).all().map((a) => [a.id, a.name]));
  return hits.map(({ assetId, animalId }) => ({ assetId, label: `Tier „${names.get(animalId) ?? animalId}“`, entity: 'animal', id: animalId, href: `/animals/${animalId}` }));
}
