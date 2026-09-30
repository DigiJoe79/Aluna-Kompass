import { schema as core, unwrap, type CallContext, type Deps, type LocalizedText } from '@kompass/core';
import { animals } from './schema';
import { createAnimal, requestAnimalReview, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory } from './service';

interface ExampleStory { quote: LocalizedText; family: string; beforeCaption: LocalizedText; afterCaption: LocalizedText }
interface ExampleAnimal {
  slug: string;
  name: string;
  sex: 'female' | 'male';
  birthText: LocalizedText;
  sizeCm: number;
  sizeText: LocalizedText;
  location: 'shelter' | 'germany';
  place: string;
  isEmergency: boolean;
  isSponsorable: boolean;
  traits: Record<string, string[]>;
  summary: LocalizedText;
  body: LocalizedText;
  status: 'lookingForHome' | 'reserved' | 'adopted';
  adoptedYear?: number;
  published: boolean;
  story?: ExampleStory;
  /** Notiz einer offenen Prüfung. Gesetzt heißt: Das Tier wartet, mit Fotos aus der Mediathek des Kern-Seeds. */
  review?: string;
}

/**
 * Beispieltiere für Entwicklung und Test — frei erfunden, weil das Repo
 * öffentlich ist. Deckt die Statusvarianten ab (sucht ein Zuhause, reserviert,
 * vermittelt), damit Liste, Filter und die veröffentlichte Sicht Inhalt haben,
 * und die zwei Fälle einer offenen Prüfung: neu und unveröffentlicht, geändert
 * und schon veröffentlicht.
 * In `development` liegen sie neben den Prototyp-Daten von `dev:reset`.
 */
const EXAMPLE_ANIMALS: ExampleAnimal[] = [
  {
    slug: 'baxter',
    name: 'Baxter',
    sex: 'male' as const,
    birthText: { de: 'März 2020', en: 'March 2020' },
    sizeCm: 55,
    sizeText: { de: 'ca. 55 cm', en: 'approx. 55 cm' },
    location: 'shelter' as const,
    place: 'Rumänien, Ploiești',
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
    place: 'Nordrhein-Westfalen',
    isEmergency: false,
    isSponsorable: true,
    traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] },
    // Bewusst ohne englische Fassung: die eine Lücke, die `translations_list_gaps` in der Entwicklung zeigt.
    summary: { de: 'Sanfte Hündin für ein ruhiges Zuhause.', en: '' },
    body: { de: 'Frida lebt bereits in einer Pflegestelle in Deutschland.', en: '' },
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
    place: 'Rumänien, Cluj-Napoca',
    isEmergency: false,
    isSponsorable: false,
    traits: { de: ['verschmust'], en: ['cuddly'] },
    summary: { de: 'Hat 2025 ihre Familie gefunden.', en: 'Found her family in 2025.' },
    body: { de: 'Nala ist vermittelt und dient hier als Beispiel für eine abgeschlossene Vermittlung.', en: 'Nala has been adopted and serves here as an example of a completed placement.' },
    status: 'adopted' as const,
    adoptedYear: 2025,
    published: false,
    story: {
      quote: { de: 'Nala schläft jetzt auf dem Sofa, als hätte sie nie woanders gelebt.', en: 'Nala now sleeps on the sofa as if she had never lived anywhere else.' },
      family: 'Familie Berger',
      beforeCaption: { de: 'Auf der Pflegestelle in Bonn', en: 'At the foster home in Bonn' },
      afterCaption: { de: 'Zuhause am Rhein', en: 'At home by the Rhine' },
    },
  },
  {
    slug: 'juno',
    name: 'Juno',
    sex: 'female' as const,
    birthText: { de: '2020', en: '2020' },
    sizeCm: 52,
    sizeText: { de: 'ca. 52 cm', en: 'approx. 52 cm' },
    location: 'germany' as const,
    place: 'Baden-Württemberg',
    isEmergency: false,
    isSponsorable: false,
    traits: { de: ['aufmerksam'], en: ['attentive'] },
    summary: { de: 'Hat 2024 ihre Familie gefunden.', en: 'Found her family in 2024.' },
    body: { de: 'Juno ist vermittelt; ihre Geschichte hat keine Bildunterschriften.', en: 'Juno has been adopted; her story carries no captions.' },
    status: 'adopted' as const,
    adoptedYear: 2024,
    published: true,
    story: {
      quote: { de: 'Sie hat uns vom ersten Tag an ausgesucht.', en: 'She chose us from day one.' },
      family: 'Familie Kaya',
      beforeCaption: {},
      afterCaption: {},
    },
  },
  {
    slug: 'pelle',
    name: 'Pelle',
    sex: 'male' as const,
    birthText: { de: 'Mai 2023', en: 'May 2023' },
    sizeCm: 38,
    sizeText: { de: 'ca. 38 cm', en: 'approx. 38 cm' },
    location: 'shelter' as const,
    place: 'Rumänien, Brașov',
    isEmergency: false,
    isSponsorable: true,
    traits: { de: ['neugierig', 'verspielt'], en: ['curious', 'playful'] },
    summary: { de: 'Junger Rüde, frisch im Shelter angekommen.', en: 'Young boy, newly arrived at the shelter.' },
    body: { de: 'Pelle ist neu angelegt und wartet darauf, dass jemand Texte und Fotos ansieht.', en: 'Pelle was newly created and waits for someone to look at texts and photos.' },
    status: 'lookingForHome' as const,
    published: false,
    review: 'neu',
  },
  {
    slug: 'mika',
    name: 'Mika',
    sex: 'female' as const,
    birthText: { de: '2021', en: '2021' },
    sizeCm: 46,
    sizeText: { de: 'ca. 46 cm', en: 'approx. 46 cm' },
    location: 'germany' as const,
    place: 'Niedersachsen',
    isEmergency: false,
    isSponsorable: false,
    traits: { de: ['anhänglich', 'stubenrein'], en: ['affectionate', 'house-trained'] },
    summary: { de: 'Lebt inzwischen auf einer Pflegestelle.', en: 'Now lives in a foster home.' },
    body: { de: 'Mika ist veröffentlicht; ihr Profil wurde geändert und wartet auf eine Prüfung.', en: 'Mika is published; her profile was changed and waits for a review.' },
    status: 'lookingForHome' as const,
    published: true,
    review: 'Text und Fotos geändert',
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
        place: a.place,
        isEmergency: a.isEmergency,
        isSponsorable: a.isSponsorable,
        traits: a.traits,
        summary: a.summary,
        body: a.body,
      }),
    );
    // `createAnimal` legt jedes Tier als „sucht ein Zuhause“ an; abweichende
    // Zustände kommen über den regulären Statuswechsel.
    if (a.status !== 'lookingForHome') {
      unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: a.status, adoptedYear: a.adoptedYear }));
    }
    if (a.status === 'adopted' && a.story) {
      unwrap(await setAnimalStory(deps, ctx, { id: created.id, beforeAssetId: null, afterAssetId: null, quote: a.story.quote, family: a.story.family, adoptedYear: a.adoptedYear!, beforeCaption: a.story.beforeCaption, afterCaption: a.story.afterCaption }));
    }
    if (a.published) unwrap(await setAnimalPublished(deps, ctx, { id: created.id, isPublished: true }));
    if (a.review !== undefined) {
      // Fotos aus der Mediathek des Kern-Seeds (`seedMedia` läuft vorher); ohne sie bleibt das Tier ohne Fotos.
      const photos = deps.db.select({ id: core.mediaAssets.id, mimeType: core.mediaAssets.mimeType, filename: core.mediaAssets.filename }).from(core.mediaAssets).all()
        .filter((m) => m.mimeType.startsWith('image/') && m.mimeType !== 'image/svg+xml')
        .sort((x, y) => (x.filename < y.filename ? -1 : 1))
        .slice(0, 3);
      if (photos.length > 0) unwrap(await setAnimalPhotos(deps, ctx, { id: created.id, photos: photos.map((m, i) => ({ assetId: m.id, isPrimary: i === 0 })) }));
      // Der Seed läuft auf dem Kanal `system`: Der Merker kommt nur aus diesem ausdrücklichen Aufruf.
      unwrap(await requestAnimalReview(deps, ctx, { id: created.id, note: a.review }));
    }
  }
}
