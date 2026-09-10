import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { animals } from './schema';
import { createAnimal, setAnimalPublished, setAnimalStatus } from './service';

/**
 * Beispieltiere für Entwicklung und Test — frei erfunden, weil das Repo
 * öffentlich ist. Deckt die Statusvarianten ab (sucht ein Zuhause, reserviert,
 * vermittelt), damit Liste, Filter und die veröffentlichte Sicht Inhalt haben.
 * In `development` liegen sie neben den Prototyp-Daten von `dev:reset`.
 */
const EXAMPLE_ANIMALS = [
  {
    slug: 'baxter',
    name: 'Baxter',
    sex: 'male' as const,
    birthText: { de: 'März 2020', en: 'March 2020' },
    sizeCm: 55,
    sizeText: { de: 'ca. 55 cm', en: 'approx. 55 cm' },
    location: 'shelter' as const,
    isEmergency: true,
    isSponsorable: false,
    traits: { de: ['aufgeweckt', 'menschenbezogen'], en: ['lively', 'people-oriented'] },
    summary: { de: 'Fröhlicher Rüde, der gern lernt.', en: 'Cheerful boy who loves to learn.' },
    body: { de: 'Baxter kam aus einer Auffangstation und sucht ein aktives Zuhause.', en: 'Baxter came from a rescue station and is looking for an active home.' },
    status: 'lookingForHome' as const,
    published: true,
  },
  {
    slug: 'frida',
    name: 'Frida',
    sex: 'female' as const,
    birthText: { de: '2019', en: '2019' },
    sizeCm: 42,
    sizeText: { de: 'ca. 42 cm', en: 'approx. 42 cm' },
    location: 'germany' as const,
    isEmergency: false,
    isSponsorable: true,
    traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] },
    summary: { de: 'Sanfte Hündin für ein ruhiges Zuhause.', en: 'Gentle girl for a quiet home.' },
    body: { de: 'Frida lebt bereits in einer Pflegestelle in Deutschland.', en: 'Frida already lives in a foster home in Germany.' },
    status: 'reserved' as const,
    published: false,
  },
  {
    slug: 'nala',
    name: 'Nala',
    sex: 'female' as const,
    birthText: { de: '2018', en: '2018' },
    sizeCm: 48,
    sizeText: { de: 'ca. 48 cm', en: 'approx. 48 cm' },
    location: 'shelter' as const,
    isEmergency: false,
    isSponsorable: false,
    traits: { de: ['verschmust'], en: ['cuddly'] },
    summary: { de: 'Hat 2025 ihre Familie gefunden.', en: 'Found her family in 2025.' },
    body: { de: 'Nala ist vermittelt und dient hier als Beispiel für eine abgeschlossene Vermittlung.', en: 'Nala has been adopted and serves here as an example of a completed placement.' },
    status: 'adopted' as const,
    adoptedYear: 2025,
    published: false,
  },
];

/** Legt die Beispieltiere an, sofern noch keine Tiere existieren. */
export async function seedAnimals(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: animals.id }).from(animals).all().length > 0) return;
  for (const a of EXAMPLE_ANIMALS) {
    const created = unwrap(
      await createAnimal(deps, ctx, {
        slug: a.slug,
        name: a.name,
        sex: a.sex,
        birthText: a.birthText,
        sizeCm: a.sizeCm,
        sizeText: a.sizeText,
        location: a.location,
        isEmergency: a.isEmergency,
        isSponsorable: a.isSponsorable,
        traits: a.traits,
        summary: a.summary,
        body: a.body,
      }),
    );
    // `createAnimal` legt jedes Tier als „sucht ein Zuhause" an; abweichende
    // Zustände kommen über den regulären Statuswechsel.
    if (a.status !== 'lookingForHome') {
      unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: a.status, adoptedYear: a.adoptedYear }));
    }
    if (a.published) unwrap(await setAnimalPublished(deps, ctx, { id: created.id, isPublished: true }));
  }
}
