import { SEED_PHOTO_FOLDER, seedPhotoIds, unwrap, writeSettingInternal, type CallContext, type Deps, type LocalizedText } from '@kompass/core';
import { animals } from './schema';
import { PROFILE_URL_KEY } from './settings';
import { createAnimal, requestAnimalReview, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory } from './service';

interface ExampleStory {
  quote: LocalizedText;
  family: string;
  beforeCaption: LocalizedText;
  afterCaption: LocalizedText;
  /** Präfix eines Bildes aus `Fotos/Tiere` (Kern-Seed) für Vorher bzw. Nachher. */
  beforePhoto?: string;
  afterPhoto?: string;
}
interface ExampleAnimal {
  /** Nur zur Orientierung im Code; den Slug bildet Kompass. */
  key: string;
  /** Präfix der eigenen Bilder in `Fotos/Tiere` (Kern-Seed, `seedPhotoIds`); das erste ist das Hauptfoto. */
  photos: string;
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
  /** Notiz einer offenen Prüfung. Gesetzt heißt: Das Tier wartet. */
  review?: string;
  /**
   * Wie lange die Prüfung schon wartet. Die Warteschlange sortiert nach dem Zeitpunkt; ohne Abstand
   * bekämen zwei Tiere im selben Seed-Lauf denselben, und der Name entschiede die Reihenfolge.
   */
  reviewHoursAgo?: number;
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
    key: 'baxter',
    photos: 'baxter-',
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
    key: 'frida',
    photos: 'frida-',
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
    key: 'nala',
    photos: 'nala-nachher-',
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
      beforePhoto: 'nala-vorher-',
      afterPhoto: 'nala-nachher-',
    },
  },
  {
    key: 'juno',
    photos: 'juno-',
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
    key: 'pelle',
    photos: 'pelle-',
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
    reviewHoursAgo: 26,
  },
  {
    key: 'mika',
    photos: 'mika-',
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
    // Lang genug, dass der PDF-Export ihn kleiner setzt und kürzt (Spec 2026-10-05, § 11).
    body: { de: 'Mika kam im Frühjahr zu uns auf die Pflegestelle, ein wenig mager und sehr vorsichtig. In den ersten Tagen beobachtete sie alles aus sicherer Entfernung, am liebsten vom Flur aus, wo sie Küche und Wohnzimmer zugleich im Blick hatte. Nach einer Woche legte sie sich zum ersten Mal neben das Sofa, nach zwei Wochen darauf. Heute begrüßt sie jeden, der nach Hause kommt, mit einem leisen Brummen und wedelndem Hinterteil, als hätte sie nie anders gelebt.\n\nSpaziergänge liebt Mika über alles. Sie läuft gut an der lockeren Leine, bleibt aber gern stehen, um Gräser und Zaunpfähle ausführlich zu untersuchen. Auf Feldwegen ist sie aufmerksam und ruhig, an belebten Straßen braucht sie noch ein wenig Zuspruch, wenn ein Lastwagen vorbeifährt. Eine Stunde am Stück schafft sie problemlos, danach schläft sie zufrieden im Körbchen. Im Freilauf haben wir sie bisher nicht erlebt, eine Schleppleine empfehlen wir für den Anfang ausdrücklich.\n\nAnderen Hunden begegnet Mika freundlich, wenn sie ihr Zeit lassen. Mit dem älteren Rüden der Pflegestelle teilt sie sich inzwischen Garten und Wassernapf, beim Fressen möchte sie aber ihre Ruhe haben. Stürmische Junghunde sind ihr zu viel, dann dreht sie ab und sucht die Nähe ihrer Menschen. Katzen kennt sie aus der Nachbarschaft, sie schaut ihnen interessiert hinterher, jagt aber nicht. Ein Zuhause mit einem gelassenen Ersthund wäre schön, ist aber keine Bedingung.\n\nAutofahren war anfangs schwierig: Mika zitterte und hechelte schon beim Einsteigen. Mit kurzen Fahrten zum Waldparkplatz, die jedes Mal mit einem schönen Spaziergang endeten, hat sie gelernt, dass das Auto etwas Gutes bedeutet. Inzwischen springt sie selbst in die Box im Kofferraum und legt sich hin. Längere Strecken über eine Stunde haben wir noch nicht ausprobiert. Wir geben den neuen Menschen gern weiter, wie wir das Training aufgebaut haben.\n\nAlleinbleiben übt Mika seit einigen Wochen in kleinen Schritten. Zwei Stunden schafft sie inzwischen entspannt, wenn sie vorher ausgelastet ist und ihr Kauknochen bereitliegt. Die Kamera zeigt, dass sie die meiste Zeit verschläft und nur kurz an der Tür horcht. Bellen oder Zerstören kam bisher nicht vor. Ein Zuhause, in dem sie nicht täglich viele Stunden allein bleiben muss, wäre für sie trotzdem am besten, gerade in der ersten Zeit nach dem Umzug.\n\nBeim Futter ist Mika unkompliziert. Sie bekommt zweimal täglich Trockenfutter mit etwas Gemüse und verträgt das gut. Leckerlis nimmt sie sanft aus der Hand, was beim Training sehr hilft. Unverträglichkeiten sind nicht bekannt. Weil sie gern bettelt, achten wir darauf, dass am Tisch nichts für sie abfällt, und wir bitten die neuen Menschen, das beizubehalten. Ihr Gewicht hat sich auf der Pflegestelle gut eingependelt, sie ist jetzt schlank, aber nicht mehr dünn.\n\nBeim Tierarzt war Mika mehrfach zur Kontrolle. Sie ist geimpft, gechippt, entwurmt und kastriert, alle Befunde waren unauffällig. Untersuchungen lässt sie ruhig über sich ergehen, wenn jemand Vertrautes dabei ist und ihr gut zuredet. Krallenschneiden mag sie nicht besonders, duldet es aber mit etwas Geduld und Käsewürfeln. Den Impfpass und die Berichte der Untersuchungen geben wir bei der Vermittlung selbstverständlich mit, ebenso eine Liste ihrer Gewohnheiten.\n\nFür Mika suchen wir Menschen mit Zeit und Ruhe, die ihr einen festen Tagesablauf bieten. Ein Haus mit Garten ist kein Muss, eine Wohnung im Erdgeschoss oder mit Aufzug wäre aber gut, weil sie Treppen noch nicht ganz traut. Kinder ab dem Schulalter, die verstehen, dass Mika manchmal ihre Ruhe braucht, sind willkommen. Wer sie kennenlernen möchte, ist herzlich zu einem Besuch auf der Pflegestelle eingeladen, gern auch mehrmals, bevor eine Entscheidung fällt.', en: 'Mika is published; her profile was changed and waits for a review.' },
    status: 'lookingForHome' as const,
    published: true,
    review: 'Text und Fotos geändert',
    reviewHoursAgo: 3,
  },
];

/** Legt die Beispieltiere an, sofern noch keine Tiere existieren. */
export async function seedAnimals(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: animals.id }).from(animals).all().length > 0) return;
  const photosOf = (prefix: string) => seedPhotoIds(deps, SEED_PHOTO_FOLDER.animals, prefix);
  for (const a of EXAMPLE_ANIMALS) {
    const created = unwrap(
      await createAnimal(deps, ctx, {
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
    // Eigene Bilder aus der Mediathek des Kern-Seeds (`seedMedia` läuft vorher, Spec 2026-10-06 § 4);
    // ohne sie bleibt das Tier ohne Fotos. Pelle und Mika haben je drei — die Prüf-E2E tauscht das Hauptfoto.
    const photos = photosOf(a.photos);
    if (photos.length > 0) unwrap(await setAnimalPhotos(deps, ctx, { id: created.id, photos: photos.map((assetId, i) => ({ assetId, isPrimary: i === 0 })) }));
    if (a.status === 'adopted' && a.story) {
      const picture = (prefix?: string) => (prefix ? (photosOf(prefix)[0] ?? null) : null);
      unwrap(await setAnimalStory(deps, ctx, { id: created.id, beforeAssetId: picture(a.story.beforePhoto), afterAssetId: picture(a.story.afterPhoto), quote: a.story.quote, family: a.story.family, adoptedYear: a.adoptedYear!, beforeCaption: a.story.beforeCaption, afterCaption: a.story.afterCaption }));
    }
    if (a.published) unwrap(await setAnimalPublished(deps, ctx, { id: created.id, isPublished: true }));
    if (a.review !== undefined) {
      // Der Seed läuft auf dem Kanal `system`: Der Merker kommt nur aus diesem ausdrücklichen Aufruf.
      const ago = (a.reviewHoursAgo ?? 0) * 3_600_000;
      const earlier = { ...deps, clock: { now: () => new Date(deps.clock.now().getTime() - ago) } };
      unwrap(await requestAnimalReview(earlier, ctx, { id: created.id, note: a.review }));
    }
  }
  // Eine erfundene Adresse, damit der PDF-Export in der Entwicklung QR-Codes zeigt (Spec 2026-10-05, § 11).
  deps.db.transaction((tx) => unwrap(writeSettingInternal(tx, deps, ctx, PROFILE_URL_KEY, 'https://musterverein.example/tiere/{slug}/')));
}
