import { definePublishedView, derivedAssetId, localizedList, localizedText, type CropRect, type Deps } from '@kompass/core';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { animals } from './schema';
import { loadAnimal, type AnimalStory } from './service';
import { animalSlug } from './slug';

const L = localizedText();

/** Die Geschichte in der Sicht: Vorher- und Nachher-Bild mit Ausschnitt als abgeleitete ID (Spec Ausschnitt für alle Bilder § 3). */
function publishedStory(story: AnimalStory | null): AnimalStory | null {
  if (!story) return null;
  const derived = (id: string | null, crop: CropRect | null) => (id ? derivedAssetId(id, crop) : null);
  return { ...story, beforeAssetId: derived(story.beforeAssetId, story.beforeCrop), afterAssetId: derived(story.afterAssetId, story.afterCrop) };
}

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
      .map((r) => {
        const a = loadAnimal(deps.db, r.id)!;
        // Herkunft bleibt intern; der Ausschnitt steckt in der abgeleiteten ID (Spec Bildausschnitt § 2), damit der
        // Template-Vertrag gleich bleibt und die Pipeline die zugeschnittene Fassung unter dieser ID ablegt.
        return { ...a, photos: a.photos.map((p) => ({ assetId: derivedAssetId(p.assetId, p.crop), sortOrder: p.sortOrder, isPrimary: p.isPrimary })), story: publishedStory(a.story) };
      }),
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
  // Die Zeile hat keine ID, wohl aber den eindeutigen Slug.
  editLink: (deps, row) => {
    const a = deps.db.select({ id: animals.id, name: animals.name }).from(animals).where(eq(animals.slug, row.slug)).get();
    return a ? { href: `/animals/${a.id}`, title: a.name } : null;
  },
});

const NEW_ANIMAL = { sex: 'female', birthText: {}, sizeCm: 0, sizeText: {}, location: 'shelter', place: '', status: 'lookingForHome', isEmergency: false, isSponsorable: false, traits: {}, externalProfileUrl: '', summary: {}, body: {}, story: null };

/**
 * Die Zeile von `publishedAnimals` für eine Wahl, ohne zu speichern (Vorschau einer Prüfung, Plan Vorschläge B):
 * heutiger Hund (oder die Vorgaben eines neuen) mit den gewählten Werten und Fotos. Ohne `ctx` — das Recht prüft der
 * Aufrufer (`animals.manage`). Ein neuer Hund bekommt den Slug, den er beim Anlegen bekäme, aus `slugId`. Ein Foto
 * mit `crop` bekommt wie in der Sicht die abgeleitete ID.
 */
export function publishedRowFor(deps: Deps, input: { animalId: string | null; slugId?: string; values: Record<string, unknown>; photos: readonly { assetId: string; isPrimary: boolean; crop?: CropRect | null }[] }): unknown {
  const base: Record<string, unknown> = input.animalId ? { ...loadAnimal(deps.db, input.animalId)! } : { ...NEW_ANIMAL };
  const merged: Record<string, unknown> = { ...base, ...input.values };
  merged.story = publishedStory((merged.story as AnimalStory | null | undefined) ?? null);
  if (!input.animalId) merged.slug = animalSlug(String(merged.name ?? ''), input.slugId ?? '');
  merged.photos = input.photos.map((p, i) => ({ assetId: derivedAssetId(p.assetId, p.crop), sortOrder: i + 1, isPrimary: p.isPrimary }));
  return publishedAnimals.schema.parse(merged);
}
