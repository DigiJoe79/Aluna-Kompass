import type { Deps, MediaReference } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { projects } from './schema';

/** Wo ein Bild in Projekten hängt — für „Wird verwendet in“ der Mediathek. */
export function projectsMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return deps.db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.imageAssetId, assetId))
    .all()
    .map((p) => ({ label: `Projekt „${p.slug}“`, entity: 'project', id: p.id }));
}
