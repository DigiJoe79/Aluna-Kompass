import { definePublishedView, localizedList, localizedText } from '@kompass/core';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { animals } from './schema';
import { loadAnimal } from './service';

const L = localizedText();

export const publishedAnimals = definePublishedView({
  name: 'animals',
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    sex: z.enum(['female', 'male']),
    birthText: L,
    sizeCm: z.number(),
    sizeText: L,
    location: z.enum(['shelter', 'germany']),
    place: z.string(),
    status: z.enum(['lookingForHome', 'reserved', 'adopted']),
    isEmergency: z.boolean(),
    isSponsorable: z.boolean(),
    // Welche Sprachen vorkommen, entscheidet die Installation — und der Dienst
    // nimmt auch ein Teil-Record an. Die Sicht darf nicht strenger sein als er.
    traits: localizedList(),
    externalProfileUrl: z.string(),
    summary: L,
    body: L,
    photos: z.array(z.object({ assetId: z.string(), sortOrder: z.number(), isPrimary: z.boolean() })),
    story: z
      .object({
        beforeAssetId: z.string().nullable(),
        afterAssetId: z.string().nullable(),
        quote: L,
        family: z.string(),
        adoptedYear: z.number(),
        beforeCaption: L,
        afterCaption: L,
      })
      .nullable(),
  }),
  load: (deps) =>
    deps.db
      .select({ id: animals.id })
      .from(animals)
      .where(eq(animals.isPublished, true))
      .orderBy(asc(animals.name))
      .all()
      .map((r) => loadAnimal(deps.db, r.id)!),
  // Nur Veröffentlichtes: Ein unveröffentlichtes Profil mit Merker geht nicht
  // live und gehört in die Prüfliste, nicht in die Warnung vor dem Publish.
  pendingReview: (deps) =>
    deps.db
      .select({ id: animals.id, name: animals.name })
      .from(animals)
      .where(and(eq(animals.isPublished, true), isNotNull(animals.reviewRequestedAt)))
      .orderBy(asc(animals.reviewRequestedAt), asc(animals.name))
      .all()
      .map((a) => ({ label: a.name, href: `/animals/${a.id}` })),
});
