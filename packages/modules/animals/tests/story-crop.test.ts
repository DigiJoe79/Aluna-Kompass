import { moduleMcpTools, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { animalsModule, getAnimal, publishedAnimals, publishedRowFor, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory } from '../src';
import { animalsMediaReferences } from '../src/references';
import { animal, manager, png, proposalDeps } from './proposal-fixture';

// Spec Ausschnitt für alle Bilder § 3: Vorher- und Nachher-Bild der Geschichte bekommen je einen Ausschnitt.
async function adopted() {
  const d = await proposalDeps();
  const a = await animal(d);
  unwrap(await setAnimalStatus(d, manager, { id: a.id, status: 'adopted', adoptedYear: 2025 }));
  const m1 = unwrap(await storeMediaAsset(d, manager, { originalName: 'a.png', bytes: await png(11) }));
  const m2 = unwrap(await storeMediaAsset(d, manager, { originalName: 'b.png', bytes: await png(12) }));
  const m3 = unwrap(await storeMediaAsset(d, manager, { originalName: 'c.png', bytes: await png(13) }));
  const story = { id: a.id, beforeAssetId: m1.id, afterAssetId: m2.id, quote: { de: 'Glück', en: '' }, family: 'Familie M.', adoptedYear: 2025 };
  return { d, a, m1, m2, m3, story };
}

describe('story crop', () => {
  it('stores and rounds a crop per picture, and refuses one outside the picture', async () => {
    const { d, story } = await adopted();
    const saved = unwrap(await setAnimalStory(d, manager, { ...story, beforeCrop: { x: 0.123456, y: 0, w: 0.5, h: 1 }, afterCrop: null }));
    expect(saved.story).toMatchObject({ beforeCrop: { x: 0.1235, y: 0, w: 0.5, h: 1 }, afterCrop: null });
    const outside = await setAnimalStory(d, manager, { ...story, afterCrop: { x: 0.6, y: 0, w: 0.5, h: 1 } });
    expect(outside.ok === false && outside.error.type === 'validation').toBe(true);
  });

  it('keeps the crop while the picture stays, drops it with another or no picture, null removes it', async () => {
    const { d, story, m3 } = await adopted();
    const crop = { x: 0, y: 0.1, w: 1, h: 0.8 };
    unwrap(await setAnimalStory(d, manager, { ...story, beforeCrop: crop, afterCrop: crop }));
    const kept = unwrap(await setAnimalStory(d, manager, { ...story, family: 'Familie N.' }));
    expect(kept.story).toMatchObject({ beforeCrop: crop, afterCrop: crop });
    const swapped = unwrap(await setAnimalStory(d, manager, { ...story, beforeAssetId: m3.id, afterAssetId: null }));
    expect(swapped.story).toMatchObject({ beforeCrop: null, afterCrop: null });
    unwrap(await setAnimalStory(d, manager, { ...story, beforeAssetId: m3.id, beforeCrop: crop }));
    const cleared = unwrap(await setAnimalStory(d, manager, { ...story, beforeAssetId: m3.id, beforeCrop: null }));
    expect(cleared.story!.beforeCrop).toBeNull();
  });

  it('writes the crop into the audit entry of animals.setStory', async () => {
    const { d, a, story } = await adopted();
    unwrap(await setAnimalStory(d, manager, { ...story, beforeCrop: { x: 0, y: 0, w: 0.5, h: 0.5 } }));
    const entry = d.db.select().from(schema.auditLog).all().filter((e) => e.entityId === a.id).at(-1)!;
    expect(entry.action).toBe('animals.setStory');
    expect(JSON.parse(entry.after!)).toMatchObject({ beforeCrop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
  });

  it('gives the published story the derived IDs, the template contract stays as it is', async () => {
    const { d, a, m1, m2, story } = await adopted();
    unwrap(await setAnimalStory(d, manager, { ...story, beforeCrop: { x: 0.1, y: 0, w: 0.8, h: 1 } }));
    unwrap(await setAnimalPublished(d, manager, { id: a.id, isPublished: true }));
    const row = publishedAnimals.load(d)[0] as { story: Record<string, unknown> };
    expect(row.story.beforeAssetId).toBe(`${m1.id}~1000_0_8000_10000`);
    expect(row.story.afterAssetId).toBe(m2.id);
    expect(Object.keys(row.story)).not.toContain('beforeCrop');
    const preview = publishedRowFor(d, { animalId: a.id, values: {}, photos: [] }) as { story: Record<string, unknown> };
    expect(preview.story.beforeAssetId).toBe(`${m1.id}~1000_0_8000_10000`);
  });

  it('takes the crops through animals_set_story and returns them with animals_get, together with the image places', async () => {
    const { d, a, story } = await adopted();
    const tools = Object.fromEntries(moduleMcpTools(d, animalsModule).map((t) => [t.name, t]));
    expect(tools.animals_set_story!.description).toMatch(/beforeCrop/);
    unwrap(await tools.animals_set_story!.handler(d, manager, tools.animals_set_story!.inputSchema.parse({ ...story, afterCrop: { x: 0, y: 0, w: 0.5, h: 1 } })));
    const got = unwrap(await tools.animals_get!.handler(d, manager, { id: a.id })) as { story: { afterCrop: unknown }; imagePlaces: Record<string, { formats: string[] }> };
    expect(got.story.afterCrop).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(Object.keys(got.imagePlaces)).toEqual(['animals.primary', 'animals.gallery', 'animals.story']);
    expect(got.imagePlaces['animals.primary']!.formats).toEqual(['4:3']);
    expect(unwrap(await getAnimal(d, manager, a.id))).not.toHaveProperty('imagePlaces');
  });
});

describe('media references with crop', () => {
  it('marks a photo or story picture with crop as cropped, one without as not', async () => {
    const { d, a, m1, m2, m3, story } = await adopted();
    unwrap(await setAnimalStory(d, manager, { ...story, beforeCrop: { x: 0, y: 0, w: 0.5, h: 1 } }));
    unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m3.id, isPrimary: true, crop: { x: 0, y: 0, w: 1, h: 0.5 } }, { assetId: m2.id }] }));
    const refs = animalsMediaReferences(d, new Set([m1.id, m2.id, m3.id]));
    const of = (id: string) => refs.filter((r) => r.assetId === id);
    expect(of(m1.id)).toEqual([expect.objectContaining({ entity: 'animal', id: a.id, cropped: true })]);
    expect(of(m2.id)).toEqual([expect.objectContaining({ cropped: false })]);
    expect(of(m3.id)).toEqual([expect.objectContaining({ cropped: true })]);
  });
});
