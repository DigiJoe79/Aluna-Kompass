import { describe, expect, it } from 'vitest';
import { publishedAnimals, publishedRowFor } from '../src';
import { animal, proposalDeps } from './proposal-fixture';

/** Die Zeile der Sicht für eine Vorschau (Plan Vorschläge B, Task 12): Werte der Wahl, ohne zu speichern. */
describe('publishedRowFor', () => {
  it('mixes the chosen values into today\'s animal and takes the chosen photos in order', async () => {
    const deps = await proposalDeps();
    const luna = await animal(deps);
    const row = publishedRowFor(deps, { animalId: luna.id, values: { sizeCm: 55, summary: { de: 'Neu.', en: '' } }, photos: [{ assetId: 'B', isPrimary: false }, { assetId: 'A', isPrimary: true }] }) as Record<string, unknown>;
    expect(row).toMatchObject({ slug: luna.slug, name: 'Luna', sizeCm: 55, summary: { de: 'Neu.' }, photos: [{ assetId: 'B', sortOrder: 1, isPrimary: false }, { assetId: 'A', sortOrder: 2, isPrimary: true }] });
    expect(publishedAnimals.schema.safeParse(row).success).toBe(true);
  });

  it('builds a row for a new dog from the proposed values with a slug like the one it would get', async () => {
    const deps = await proposalDeps();
    const row = publishedRowFor(deps, { animalId: null, slugId: '01PROPOSAL0000000000ABCD', values: { name: 'Lotte', sex: 'female', birthText: { de: '2021' }, sizeText: {}, summary: { de: 'Fröhlich.' }, body: {} }, photos: [] }) as Record<string, unknown>;
    expect(row).toMatchObject({ slug: 'lotte-abcd', name: 'Lotte', status: 'lookingForHome', isEmergency: false, story: null, photos: [] });
    expect(publishedAnimals.schema.safeParse(row).success).toBe(true);
  });
});
