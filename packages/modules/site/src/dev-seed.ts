import { existsSync } from 'node:fs';
import path from 'node:path';
import { type CallContext, type Deps, newId, readLocales, readSetting, schema as core, SEED_PHOTO_FOLDER, unwrap, writeSettingInternal } from '@kompass/core';
import { siteTemplateDir } from './env';
import { BASELINE_ENVIRONMENT, currentContentManifest } from './pending';
import type { ContentManifest } from './public-content';
import { widgetOf } from './field-schema';
import { createEntry, setEntryPublished } from './entries';
import { siteEntries, sitePublishes, siteValues } from './schema';
import { activeTemplate, applyTemplateSync } from './service';
import { lastSuccessfulPublish, recordPublish } from './services/publishes';
import { setValues } from './values';
import type { FieldSchema } from './types';

/**
 * Entwicklungsdaten für die Webseite — das Gegenstück zu `seedContacts`,
 * `seedAnimals` und den anderen Modul-Seeds (AGENTS.md, „Seed-Daten für jedes
 * Modul“). Bis zum 2026-09-15 war die Webseite das einzige Modul ohne: Nach
 * `pnpm seed` waren Kontakte, Akte, Tiere und Projekte gefüllt, und wer die
 * Webseite ansah, fand eine leere Oberfläche ohne einen einzigen Eintrag.
 *
 * Der Seed kennt **kein** Template. Er liest die Deklaration des Templates,
 * das im Volume liegt, und erfindet zu jedem Feld einen passenden Wert. Ein
 * Verein mit eigenem Template bekommt damit dieselbe Hilfe wie das
 * mitgelieferte Beispiel, ohne dass hier ein Sammlungsname steht.
 *
 * Abgegrenzt vom **Startinhalt** aus `seed.ts`: Der trägt die echten Inhalte
 * eines Vereins und wird einmal übernommen (Spec `2026-09-08-site-seed-design`).
 * Bringt ein Template die mit, tritt dieser Seed zurück — erfundene Notizen
 * verdeckten sonst die Karte „Startinhalte übernehmen“, weil sie nur bei leerer
 * Webseite erscheint.
 */
export async function seedSiteDevelopment(deps: Deps, ctx: CallContext): Promise<void> {
  // Sperrwörter hängen nicht am Template (Backlog 23). Erfunden und so gewählt,
  // dass sie in keinem erfundenen Inhalt vorkommen — sonst sperrte der Seed den
  // Publish, den die E2E-Suite gleich danach probt.
  if (readSetting<string[]>(deps, 'site.blockedTerms').length === 0) {
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'site.blockedTerms', ['Alter Beispielname e.V.', 'TODO-Platzhalter'], 'site.blockedTerms.set'));
  }
  // Eine erfundene Historie, damit Liste, Status und Kachel in der Entwicklung
  // nicht leer sind (Durchsicht U7). Der abgebrochene Lauf liegt vor dem
  // erfolgreichen, die Kachel bleibt ruhig. Leeres Manifest: Der nächste echte
  // Publish vergleicht gegen nichts, wie ohne Seed.
  if (!deps.db.select({ id: sitePublishes.id }).from(sitePublishes).get()) {
    const none = { changed: [], added: [], removed: [] };
    // Beide Quellen der Historie: einmal die Oberfläche, einmal ein MCP-Zugang (erfundener, nicht benutzbarer Token).
    // Relativ zu heute, nie auf einem festen Datum: Ein Seed an einem früheren Tag hätte sonst Publishes aus der Zukunft.
    const daysAgo = (days: number) => new Date(deps.clock.now().getTime() - days * 86_400_000).toISOString();
    const tokenId = newId();
    deps.db.insert(core.apiTokens).values({ id: tokenId, userId: ctx.userId!, name: 'Beispiel-Zugang', prefix: 'dev_beispiel', tokenHash: `seed-unusable-${tokenId}`, createdAt: daysAgo(36) }).run();
    const viaUi = { ...ctx, channel: 'ui' as const, apiTokenId: null };
    const viaMcp = { ...ctx, channel: 'mcp' as const, apiTokenId: tokenId };
    recordPublish(deps, viaUi, { environment: deps.env, startedAt: daysAgo(17), status: 'aborted', contentHash: '', diff: none, fileManifest: {}, log: 'Beispiel: Sperrworttreffer in variables.claim — abgebrochen.', summary: 'Beispiel-Abbruch' });
    recordPublish(deps, viaMcp, { environment: deps.env, startedAt: daysAgo(10), status: 'success', contentHash: 'beispiel', diff: none, fileManifest: {}, log: 'Beispiel: übertragen.', summary: 'Beispiel-Publish' });
  }
  if (deps.db.select().from(siteEntries).get() || deps.db.select().from(siteValues).get()) return;

  const dir = siteTemplateDir();
  if (!existsSync(path.join(dir, 'kompass.template.ts'))) return;
  // Ein Template mit eigenen Startinhalten hat das bessere Angebot.
  if (existsSync(path.join(dir, 'seed', 'content.json'))) return;

  if (!activeTemplate(deps)) {
    const gelesen = await applyTemplateSync(deps, ctx, { dir, confirm: true });
    // Ein Template, das nicht lädt, ist kein Grund, den ganzen Seed abzubrechen:
    // Die anderen Module haben ihre Daten schon geschrieben.
    if (!gelesen.ok) return;
  }
  const template = activeTemplate(deps);
  if (!template) return;

  const locales = readLocales(deps);
  const schema = template.schema;
  /**
   * Die Bilder, die der Kern-Seed vorher angelegt hat. Ein Bildfeld leer zu
   * lassen hieße, dass in der Entwicklung nie eines in einer Liste erscheint —
   * und gerade die Bildausgabe will man dort sehen.
   */
  const bilder: Bild[] = deps.db
    .select({ id: core.mediaAssets.id, mimeType: core.mediaAssets.mimeType, folder: core.mediaAssets.folder, filename: core.mediaAssets.filename })
    .from(core.mediaAssets)
    .all()
    .filter((a) => a.mimeType.startsWith('image/'))
    // Absteigend nach Namen: „startseite“ vor „aktuelles“, unabhängig vom Zufall der IDs.
    .sort((a, b) => (a.filename < b.filename ? 1 : -1));

  const variables: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.variables)) {
    const wert = beispielwert(field, key, locales, 0, false);
    if (wert !== undefined) variables[key] = wert;
  }
  for (const [key, field] of Object.entries(schema.variables)) {
    if (widgetOf(field) !== 'asset') continue;
    const gewaehlt = passendesBild(field, key, bilder, 0);
    if (gewaehlt) variables[key] = gewaehlt;
  }
  if (Object.keys(variables).length > 0) unwrap(await setValues(deps, ctx, { values: variables }));

  for (const [key, collection] of Object.entries(schema.collections)) {
    const anzahl = Math.min(collection.max ?? ANZAHL, ANZAHL);
    // Eine Sammlung mit einem Dateifeld, das keine Bilder nimmt, sammelt Dokumente: Ihre Titel sind Dokumenttitel.
    const dateien = Object.values(collection.fields).some((f) => widgetOf(f) === 'asset' && !nimmtBilder(f));
    // Ein Slug ist je Sammlung eindeutig (`slugTaken` in entries.ts).
    const slugs = new Set<string>();
    for (let i = 0; i < anzahl; i++) {
      const data: Record<string, unknown> = {};
      for (const [feldName, field] of Object.entries(collection.fields)) {
        const wert = beispielwert(field, feldName, locales, i, dateien);
        if (wert !== undefined) data[feldName] = wert;
        // Der letzte Eintrag bleibt ohne Bild: auch „kein Bild“ ist ein
        // Zustand, den die Ausgabe beherrschen muss.
        if (widgetOf(field) === 'asset' && i < anzahl - 1) {
          const gewaehlt = passendesBild(field, feldName, bilder, i);
          if (gewaehlt) data[feldName] = gewaehlt;
        }
      }
      const eintrag = await createEntry(deps, ctx, {
        collection: key,
        ...(collection.slug ? { slug: sprechenderSlug(collection.fields, data, i, slugs) } : {}),
        data,
      });
      if (!eintrag.ok) continue;
      // Varianten der Zustände: Der erste Eintrag ist veröffentlicht, die
      // übrigen bleiben Entwurf — sonst zeigt die Liste nur eine Farbe.
      if (collection.publishable && i === 0) {
        await setEntryPublished(deps, ctx, { id: eintrag.value.id, isPublished: true });
      }
    }
  }
}

/**
 * Ein erfundener Publish der **Produktion** mit festgehaltenem Stand, damit „nicht publiziert“ in der Entwicklung, in
 * der E2E-Suite und auf den Handbuch-Bildern etwas zeigt (0.2.10). Produktion, weil nur deren Stand als Webseite gilt
 * (`BASELINE_ENVIRONMENT`); publiziert wird dabei nichts, und die Historie der eigenen Umgebung bleibt, wie sie ist.
 * Läuft als `seedLast`: Der Stand rechnet aus den Tieren und Projekten der anderen Module, deren Seeds erst nach
 * diesem Modul laufen. Abgeleitet vom heutigen öffentlichen Stand und an wenigen Stellen bewusst anders — ohne einen
 * Namen aus dem Template: eine Variable (die erste Zahl, sonst die erste), der erste Eintrag einer Sammlung fehlt
 * (also neu), und je Sicht eines Moduls der erste Datensatz. Die Sicht des Vereinsstamms bleibt, wie sie ist.
 */
export async function seedSitePublishedState(deps: Deps, ctx: CallContext): Promise<void> {
  if (lastSuccessfulPublish(deps, BASELINE_ENVIRONMENT)) return;
  const current = currentContentManifest(deps);
  const template = activeTemplate(deps);
  if (!current || !template) return;
  const keys = Object.keys(current);
  const variables = keys.filter((k) => k.startsWith('variables.'));
  const number = variables.find((k) => widgetOf(template.schema.variables[k.slice('variables.'.length)]!) === 'number');
  const changed = [number ?? variables[0], ...firstPerView(keys)].filter((k): k is string => k !== undefined);
  const added = keys.find((k) => k.startsWith('entries.'));
  const baseline: ContentManifest = {};
  for (const [key, item] of Object.entries(current)) {
    if (key === added) continue;
    baseline[key] = changed.includes(key) ? { ...item, hash: `beispiel-${item.hash}` } : item;
  }
  const daysAgo = (days: number) => new Date(deps.clock.now().getTime() - days * 86_400_000).toISOString();
  // Über die Oberfläche wie das Beispiel der eigenen Umgebung: Der Kanal `system` des Seeds hieße in der Historie „System (Neustart)“.
  recordPublish(deps, { ...ctx, channel: 'ui', apiTokenId: null }, {
    environment: BASELINE_ENVIRONMENT,
    startedAt: daysAgo(10),
    status: 'success',
    contentHash: 'beispiel',
    diff: { changed: [], added: [], removed: [] },
    fileManifest: {},
    log: 'Beispiel: Stand der Produktion.',
    summary: 'Beispiel-Publish der Produktion',
    contentManifest: baseline,
  });
}

/** Je Sicht eines Moduls der erste Datensatz (Schlüssel `views.<sicht>:<adresse>`); `organization` ist der Vereinsstamm des Kerns. */
function firstPerView(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    if (!k.startsWith('views.')) return false;
    const view = k.slice('views.'.length).split(':')[0]!;
    if (view === 'organization' || seen.has(view)) return false;
    seen.add(view);
    return true;
  });
}

/**
 * URL-Teil aus dem ersten Text des Eintrags (bei mehrsprachigen Feldern der
 * deutsche, sonst der erste), wie ihn ein Mensch vergäbe:
 * „Rückblick auf unser Sommerfest“ → `rueckblick-auf-unser-sommerfest`. Bis
 * 0.2.7 stand hier `beispiel-1` (release-0.2.7.md, Befund 16). Ohne Text bleibt
 * es bei `eintrag-<n>`; die Nummer hängt auch an, wenn zwei Titel gleich wären.
 * Nur Textfelder zählen, `title` zuerst — ein Bild- oder Auswahlfeld vor dem
 * Titel gäbe sonst eine Medien-ID oder einen Enum-Wert als Slug.
 */
export function sprechenderSlug(fields: Record<string, FieldSchema>, data: Record<string, unknown>, i: number, vergeben: Set<string>): string {
  const namen = Object.keys(fields)
    .filter((name) => ['text', 'localized'].includes(widgetOf(fields[name]!)) && fields[name]!.markdown !== true)
    .sort((a, b) => Number(b === 'title') - Number(a === 'title'));
  const text = namen
    .map((name) => data[name])
    .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as Record<string, unknown>).de ?? Object.values(v)[0]) : undefined))
    .find((v): v is string => typeof v === 'string' && v.trim() !== '');
  const ascii = (text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  if (!ascii) return `eintrag-${i + 1}`;
  if (vergeben.has(ascii)) return `${ascii}-${i + 1}`;
  vergeben.add(ascii);
  return ascii;
}

/** Drei Einträge je Sammlung: genug für Sortierung und Zustände, wenig genug zum Überblicken. */
const ANZAHL = 3;

interface Bild { id: string; mimeType: string; folder: string | null; filename: string }

/** Ein Satz in den beiden Sprachen der Entwicklungsdaten; jede weitere Sprache bekommt die englische Fassung. */
interface Satz { de: string; en: string }

/**
 * Glaubwürdige Beispiele für gängige Feldnamen (Spec 2026-10-06 § 4: Pflegemaske
 * und gebaute Vorschau zeigen einen Verein, keine „Titel 1 (Beispiel)“). Der
 * Schlüssel ist der Feldname, nie ein Sammlungsname: Ein Template mit anderen
 * Namen bekommt weiter Beschriftung und Nummer.
 */
const KURZ: Record<string, readonly Satz[]> = {
  claim: [{ de: 'Gemeinsam für Tiere, die ein Zuhause suchen.', en: 'Together for animals looking for a home.' }],
  title: [
    { de: 'Winterhilfe gestartet: 40 neue Schlafboxen', en: 'Winter aid has started: 40 new shelter boxes' },
    { de: 'Rückblick auf unser Sommerfest', en: 'Looking back on our summer party' },
    { de: 'Pflegestellen gesucht', en: 'Foster homes wanted' },
  ],
  question: [
    { de: 'Wie kann ich mithelfen?', en: 'How can I help?' },
    { de: 'Ist meine Spende steuerlich absetzbar?', en: 'Is my donation tax-deductible?' },
    { de: 'Wie läuft eine Vermittlung ab?', en: 'How does an adoption work?' },
  ],
  role: [
    { de: 'Vorsitz', en: 'Chair' },
    { de: 'Kasse', en: 'Treasurer' },
    { de: 'Pflegestellen', en: 'Foster homes' },
  ],
};

/** Titel in einer Sammlung von Dateien. */
const DATEITITEL: readonly Satz[] = [
  { de: 'Satzung', en: 'Statutes' },
  { de: 'Beitragsordnung', en: 'Schedule of fees' },
  { de: 'Datenschutzhinweise', en: 'Privacy notice' },
];

/** Längere Texte (Markdown). */
const LANG: Record<string, readonly Satz[]> = {
  intro: [
    {
      de: 'Wir sind ein kleiner Verein mit großem Netzwerk: Pflegestellen, Tierärztinnen und viele Helfende sorgen dafür, dass Hunde aus dem Tierschutz gut ankommen.\n\nSchauen Sie sich um, lernen Sie unsere Tiere kennen — und melden Sie sich, wenn Sie helfen möchten.',
      en: 'We are a small association with a big network: foster homes, vets and many helpers make sure that rescue dogs arrive well.\n\nHave a look around, meet our animals — and get in touch if you would like to help.',
    },
  ],
  body: [
    {
      de: 'Seit Anfang des Monats stehen an fünf Futterstellen isolierte Schlafboxen. Gebaut haben sie Freiwillige an zwei Samstagen, das Holz kam als Spende aus der Nachbarschaft.\n\n**Danke** an alle, die mit angepackt haben. Wer eine Box betreuen möchte, meldet sich bei uns.',
      en: 'Since the start of the month, insulated shelter boxes stand at five feeding stations. Volunteers built them on two Saturdays; the wood was donated by neighbours.\n\n**Thank you** to everyone who helped. If you would like to look after a box, get in touch.',
    },
    {
      de: 'Über 200 Gäste, drei vermittelte Hunde und ein Kuchenbuffet, das bis zum Abend reichte: Unser Sommerfest war ein voller Erfolg.\n\nDie Einnahmen fließen in die Tierarztkosten für das kommende Halbjahr.',
      en: 'More than 200 guests, three dogs adopted and a cake buffet that lasted until the evening: our summer party was a great success.\n\nThe proceeds go towards vet costs for the coming six months.',
    },
    {
      de: 'Für den Herbst suchen wir zwei neue Pflegestellen in und um Musterstadt. Wir begleiten Sie mit Futter, Tierarzt und einem festen Ansprechpartner.\n\n- Erfahrung mit Hunden hilft, ist aber keine Bedingung\n- Ein eingezäunter Garten ist schön, aber kein Muss',
      en: 'For the autumn we are looking for two new foster homes in and around Musterstadt. We support you with food, vet care and a fixed contact person.\n\n- Experience with dogs helps but is not required\n- A fenced garden is nice but not a must',
    },
  ],
  answer: [
    {
      de: 'Als Pflegestelle, beim Fahrdienst zum Tierarzt, an unserem Infostand oder mit einer Spende. Schreiben Sie uns, wir finden etwas, das zu Ihnen passt.',
      en: 'As a foster home, driving to the vet, at our information stand or with a donation. Write to us and we will find something that suits you.',
    },
    {
      de: 'Ja. Wir sind als gemeinnützig anerkannt und stellen eine **Zuwendungsbestätigung** aus — bei Beträgen bis 300 Euro genügt der Kontoauszug.',
      en: 'Yes. We are recognised as a charity and issue a **donation receipt** — for amounts up to 300 euros your bank statement is enough.',
    },
    {
      de: 'Nach einem Gespräch und einem Besuch bei Ihnen lernen Sie den Hund auf seiner Pflegestelle kennen. Passt alles, schließen wir einen Schutzvertrag und bleiben auch danach erreichbar.',
      en: 'After a conversation and a visit to your home, you meet the dog at its foster home. If everything fits, we sign an adoption contract and stay in touch afterwards.',
    },
  ],
};

/** Namen für Personenfelder — die erfundenen Menschen des Seeds. */
const NAMEN: readonly string[] = ['Anna Berger', 'Jonas Feld', 'Clara Neumann'];

/** Feldnamen, unter denen ein Template ein Porträt erwartet. */
const PORTRAIT = /^(photo|portrait|avatar)$/i;

const auswahl = (liste: readonly Satz[] | undefined, index: number): Satz | undefined => (liste && liste.length > 0 ? liste[index % liste.length] : undefined);

function nimmtBilder(field: FieldSchema): boolean {
  const accept = typeof (field as { accept?: string }).accept === 'string' ? (field as { accept: string }).accept : 'image/*';
  return accept.startsWith('image/');
}

/**
 * Ein Bild aus der Mediathek, wenn das Feld Bilder annimmt. Ein Feld mit
 * `accept: 'application/pdf'` bekommt keines — die Maske ließe es nicht zu,
 * und ein Seed, der an der eigenen Prüfung vorbeischreibt, bildet nichts ab,
 * was es im Betrieb gibt. Liegen Webseiten-Fotos des Kern-Seeds vor, kommen
 * sie zuerst: Porträts für Personenfelder, Szenen für alles andere.
 */
function passendesBild(field: FieldSchema, name: string, bilder: Bild[], index: number): string | undefined {
  if (bilder.length === 0 || !nimmtBilder(field)) return undefined;
  const fotos = bilder.filter((b) => b.folder === SEED_PHOTO_FOLDER.website);
  const passend = fotos.filter((b) => b.filename.startsWith('team-') === PORTRAIT.test(name));
  const pool = passend.length > 0 ? passend : bilder;
  return pool[index % pool.length]!.id;
}

/**
 * Ein erfundener Wert, der zum Feld passt — glaubwürdig für die Feldnamen aus
 * `KURZ`, `LANG` und `NAMEN`, sonst mit der Beschriftung aus der Deklaration,
 * damit in der Maske erkennbar bleibt, welches Feld man vor sich hat.
 *
 * `undefined` heißt „dieses Feld lässt der Seed leer“ — Dateien und Verweise
 * zeigen sonst ins Nichts.
 */
function beispielwert(field: FieldSchema, name: string, locales: string[], index: number, dateien: boolean): unknown {
  const label = typeof field.label === 'string' && field.label ? field.label : name;
  const nummer = index + 1;

  switch (widgetOf(field)) {
    case 'localized': {
      const markdown = (field as { markdown?: boolean }).markdown === true;
      const beispiel = auswahl(markdown ? LANG[name] : name === 'title' && dateien ? DATEITITEL : KURZ[name], index);
      const satz: Record<string, string> = {};
      for (const locale of locales) {
        if (beispiel) satz[locale] = locale === 'de' ? beispiel.de : beispiel.en;
        else satz[locale] = locale === 'de' ? `${label} ${nummer} (Beispiel)` : `${label} ${nummer} (example)`;
      }
      return satz;
    }
    case 'markdown':
      return auswahl(LANG[name], index)?.de ?? `Beispieltext für „${label}“.\n\nDieser Absatz stammt aus dem Entwicklungs-Seed und darf überschrieben werden.`;
    case 'number': {
      const min = typeof (field as { minimum?: number }).minimum === 'number' ? (field as { minimum: number }).minimum : 0;
      return min + 12 * nummer;
    }
    case 'select':
      return (field as { enum?: string[] }).enum?.[index % ((field as { enum?: string[] }).enum?.length || 1)];
    // Eine Datei, die es nicht gibt, und ein Verweis auf einen Datensatz, den
    // ein anderes Modul führt: Beides bleibt leer statt ins Leere zu zeigen.
    case 'asset':
    case 'reference':
    case 'references':
    case 'list':
    case 'objectList':
      return undefined;
    default:
      if (name === 'name') return NAMEN[index % NAMEN.length];
      return auswahl(KURZ[name], index)?.de ?? `${label} ${nummer}`;
  }
}
