import type { AssetMediaReference, Deps } from '@kompass/core';
import { animalPhotos, animals, animalStories } from './schema';

/**
 * Wo Assets als Tierfoto oder in einer Erfolgsgeschichte hängen. Liest die
 * Foto- und Geschichtstabelle je einmal ganz und filtert hier — beide sind
 * klein, und eine IN-Liste mit tausenden IDs stieße an SQLites Grenze.
 */
export function animalsMediaReferences(deps: Deps, assetIds: ReadonlySet<string>): AssetMediaReference[] {
  // Eine Fundstelle je Asset und Tier; zugeschnitten, wenn eine Verwendung dort einen Ausschnitt hat (Spec Ausschnitt § 3).
  const hits = new Map<string, { assetId: string; animalId: string; cropped: boolean }>();
  const add = (assetId: string | null, animalId: string, cropped: boolean) => {
    if (!assetId || !assetIds.has(assetId)) return;
    const key = `${assetId}|${animalId}`;
    const hit = hits.get(key);
    if (hit) hit.cropped ||= cropped;
    else hits.set(key, { assetId, animalId, cropped });
  };
  for (const r of deps.db.select({ assetId: animalPhotos.assetId, animalId: animalPhotos.animalId, crop: animalPhotos.crop }).from(animalPhotos).all()) add(r.assetId, r.animalId, !!r.crop);
  for (const r of deps.db
    .select({ before: animalStories.beforeAssetId, after: animalStories.afterAssetId, beforeCrop: animalStories.beforeCrop, afterCrop: animalStories.afterCrop, animalId: animalStories.animalId })
    .from(animalStories)
    .all()) {
    add(r.before, r.animalId, !!r.beforeCrop);
    add(r.after, r.animalId, !!r.afterCrop);
  }
  if (hits.size === 0) return [];
  const names = new Map(deps.db.select({ id: animals.id, name: animals.name }).from(animals).all().map((a) => [a.id, a.name]));
  return [...hits.values()].map(({ assetId, animalId, cropped }) => ({ assetId, label: `Tier „${names.get(animalId) ?? animalId}“`, entity: 'animal', id: animalId, href: `/animals/${animalId}`, cropped }));
}
