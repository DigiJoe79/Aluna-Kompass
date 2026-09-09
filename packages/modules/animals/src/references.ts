import type { Deps, MediaReference } from '@kompass/core';
import { eq, or } from 'drizzle-orm';
import { animalPhotos, animals, animalStories } from './schema';

/** Wo ein Asset als Tierfoto oder in einer Erfolgsgeschichte hängt. */
export function animalsMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  const animalIds = new Set<string>();
  for (const r of deps.db.select({ id: animalPhotos.animalId }).from(animalPhotos).where(eq(animalPhotos.assetId, assetId)).all()) {
    animalIds.add(r.id);
  }
  for (const r of deps.db
    .select({ id: animalStories.animalId })
    .from(animalStories)
    .where(or(eq(animalStories.beforeAssetId, assetId), eq(animalStories.afterAssetId, assetId)))
    .all()) {
    animalIds.add(r.id);
  }
  return [...animalIds].map((id) => {
    const name = deps.db.select({ name: animals.name }).from(animals).where(eq(animals.id, id)).get()?.name ?? id;
    return { label: `Tier „${name}"`, entity: 'animal', id };
  });
}
