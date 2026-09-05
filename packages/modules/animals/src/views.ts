import { definePublishedView, localizedText } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
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
    status: z.enum(['lookingForHome', 'reserved', 'adopted']),
    isEmergency: z.boolean(),
    isSponsorable: z.boolean(),
    traits: z.object({ de: z.array(z.string()), en: z.array(z.string()) }),
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
});
