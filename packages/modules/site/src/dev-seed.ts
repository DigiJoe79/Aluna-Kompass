import { existsSync } from 'node:fs';
import path from 'node:path';
import { type CallContext, type Deps, readLocales, schema as core, unwrap } from '@kompass/core';
import { siteTemplateDir } from './env';
import { widgetOf } from './field-schema';
import { createEntry, setEntryPublished } from './entries';
import { siteEntries, siteValues } from './schema';
import { activeTemplate, applyTemplateSync } from './service';
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
  const bilder = deps.db
    .select({ id: core.mediaAssets.id, mimeType: core.mediaAssets.mimeType })
    .from(core.mediaAssets)
    .all()
    .filter((a) => a.mimeType.startsWith('image/'));

  const variables: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.variables)) {
    const wert = beispielwert(field, key, locales, 0);
    if (wert !== undefined) variables[key] = wert;
  }
  if (Object.keys(variables).length > 0) unwrap(await setValues(deps, ctx, { values: variables }));

  for (const [key, collection] of Object.entries(schema.collections)) {
    const anzahl = Math.min(collection.max ?? ANZAHL, ANZAHL);
    for (let i = 0; i < anzahl; i++) {
      const data: Record<string, unknown> = {};
      for (const [feldName, field] of Object.entries(collection.fields)) {
        const wert = beispielwert(field, feldName, locales, i);
        if (wert !== undefined) data[feldName] = wert;
        // Der letzte Eintrag bleibt ohne Bild: auch „kein Bild“ ist ein
        // Zustand, den die Ausgabe beherrschen muss.
        if (widgetOf(field) === 'asset' && i < anzahl - 1) {
          const gewaehlt = passendesBild(field, bilder, i);
          if (gewaehlt) data[feldName] = gewaehlt;
        }
      }
      const eintrag = await createEntry(deps, ctx, {
        collection: key,
        ...(collection.slug ? { slug: `beispiel-${i + 1}` } : {}),
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

/** Drei Einträge je Sammlung: genug für Sortierung und Zustände, wenig genug zum Überblicken. */
const ANZAHL = 3;

/**
 * Ein Bild aus der Mediathek, wenn das Feld Bilder annimmt. Ein Feld mit
 * `accept: 'application/pdf'` bekommt keines — die Maske ließe es nicht zu,
 * und ein Seed, der an der eigenen Prüfung vorbeischreibt, bildet nichts ab,
 * was es im Betrieb gibt.
 */
function passendesBild(field: FieldSchema, bilder: { id: string }[], index: number): string | undefined {
  if (bilder.length === 0) return undefined;
  const accept = typeof (field as { accept?: string }).accept === 'string' ? (field as { accept: string }).accept : 'image/*';
  if (!accept.startsWith('image/')) return undefined;
  return bilder[index % bilder.length]!.id;
}

/**
 * Ein erfundener Wert, der zum Feld passt. Die Beschriftung aus der
 * Deklaration geht in den Text ein, damit in der Maske erkennbar bleibt,
 * welches Feld man vor sich hat.
 *
 * `undefined` heißt „dieses Feld lässt der Seed leer“ — Dateien und Verweise
 * zeigen sonst ins Nichts.
 */
function beispielwert(field: FieldSchema, name: string, locales: string[], index: number): unknown {
  const label = typeof field.label === 'string' && field.label ? field.label : name;
  const nummer = index + 1;

  switch (widgetOf(field)) {
    case 'localized': {
      const satz: Record<string, string> = {};
      for (const locale of locales) {
        satz[locale] = locale === 'de' ? `${label} ${nummer} (Beispiel)` : `${label} ${nummer} (example)`;
      }
      return satz;
    }
    case 'markdown':
      return `Beispieltext für „${label}“.\n\nDieser Absatz stammt aus dem Entwicklungs-Seed und darf überschrieben werden.`;
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
      return `${label} ${nummer}`;
  }
}
