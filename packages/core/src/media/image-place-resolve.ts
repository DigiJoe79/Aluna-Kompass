/**
 * Bildstellen auflösen (Spec Ausschnitt für alle Bilder § 2, Handover Entscheidungen 2 und 6): aus der freiwilligen
 * Angabe des Templates (oder dem Rückfall des Moduls) die Formate, die der Ausschnitt anbietet, und die Stellen für
 * Vorschau und Schwelle. Rein, ohne Datenbank und ohne Laufzeit-Abhängigkeit — Oberfläche (`@kompass/core/image-places`)
 * und Dienste nutzen dieselbe Abbildung.
 */

/** Die Breiten, in denen die Pipeline der Webseite Bilder erzeugt. */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;
/** Größte Breite des Hauptbilds (`src`); darüber nur im `srcset`. Schwelle einer Stelle ohne Breitenangabe. */
export const MAIN_IMAGE_MAX_WIDTH = 960;

/** `'W:H'` mit ganzen Zahlen 1–99 oder `'original'` (das Bild, wie es ist). Strukturell gleich `Ratio` des Template-Pakets. */
export type ImageRatio = `${number}:${number}` | 'original';

/** Angabe einer Stelle im Template: Format(e) und Anzeigebreite in CSS-Pixeln. */
export interface ImagePlaceSpec {
  ratio: ImageRatio | ImageRatio[];
  width?: number;
}

/**
 * Eine Stelle der Webseite, an der ein Bild erscheint. `ratio: 'original'` heißt „wie gewählt“: Die Stelle zeigt den
 * Ausschnitt in seinem eigenen Format. `minWidthPx` ist die Breite, die die Pipeline für die Stelle höchstens erzeugt;
 * ein schmalerer Ausschnitt wird kleiner gezeigt (0 = kein Beitrag zur Schwelle, etwa die Lightbox). Der Name ist
 * entweder schon Text (`label`, etwa der Name eines Template-Feldes) oder ein Übersetzungsschlüssel (`labelKey`,
 * voller Pfad in `messages/de.json`).
 */
export interface ImagePlace {
  ratio: ImageRatio;
  minWidthPx: number;
  label?: string;
  labelKey?: string;
  lightbox?: true;
}

/**
 * `formats`: ein Eintrag = fest, mehrere = Auswahl nur daraus (vorgewählt der erste), leer = volle Reihe (Original,
 * 1:1, 4:3, 3:2, 16:9, jeweils quer/hoch). `source`: woher die Angabe stammt — `template`, `fallback` (Rückfall des
 * Moduls, etwa die Einstellung „Bildausschnitt“) oder `none`.
 */
export interface ResolvedImagePlaces {
  formats: ImageRatio[];
  places: ImagePlace[];
  source: 'template' | 'fallback' | 'none';
}

const RATIO = /^([1-9]\d?):([1-9]\d?)$/;
export const isImageRatio = (value: unknown): value is ImageRatio => value === 'original' || (typeof value === 'string' && RATIO.test(value));

/** Nächster Wert aus `IMAGE_WIDTHS` ab `width`; breiter als alle → der größte; ohne Angabe 960. */
export function thresholdFor(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return MAIN_IMAGE_MAX_WIDTH;
  return IMAGE_WIDTHS.find((w) => w >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

/** Die Ratios einer Angabe; was diese Fassung nicht lesen kann, fällt weg, statt angeboten zu werden. */
const ratiosOf = (ratio: unknown): ImageRatio[] => (Array.isArray(ratio) ? ratio : ratio === undefined ? [] : [ratio]).filter(isImageRatio);

export interface ResolveOptions {
  /** Gilt, wenn die Angabe fehlt oder kein lesbares Format trägt. */
  fallback?: ImageRatio;
  /** Name jeder Stelle als Text (Template-Feld). */
  label?: string;
  /** Name jeder Stelle als Übersetzungsschlüssel. */
  labelKey?: string;
  /** Je Format ein Schlüssel; gilt, wenn das Template genau so viele Formate angibt (Projekt: Kachel, Titelbild). */
  labelKeys?: readonly string[];
  /** Hängt die Stelle „Lightbox“ (wie gewählt, ohne Schwelle) an. */
  lightbox?: boolean;
  /** Schlüssel des Namens der Lightbox-Stelle. */
  lightboxLabelKey?: string;
}

/**
 * Löst eine Angabe auf; ohne Angabe (oder ohne lesbares Format) gilt `fallback`, dann die volle Reihe mit Schwelle
 * 960. Bei mehreren Formaten ist jede Stelle eine eigene (Projekt: Kachel und Titelbild), jede mit ihrer Schwelle;
 * die Oberfläche nimmt die höchste.
 */
export function resolvePlaces(spec: Partial<ImagePlaceSpec> | undefined, options: ResolveOptions = {}): ResolvedImagePlaces {
  const own = ratiosOf(spec?.ratio);
  const fallback = options.fallback && isImageRatio(options.fallback) ? options.fallback : undefined;
  const source: ResolvedImagePlaces['source'] = own.length > 0 ? 'template' : fallback ? 'fallback' : 'none';
  const formats = source === 'template' ? own : fallback ? [fallback] : [];
  const minWidthPx = thresholdFor(source === 'fallback' ? undefined : spec?.width);
  const ratios: ImageRatio[] = formats.length > 0 ? formats : ['original'];
  const nameOf = (i: number): Pick<ImagePlace, 'label' | 'labelKey'> => {
    if (options.label) return { label: options.label };
    const key = options.labelKeys && options.labelKeys.length === ratios.length && formats.length > 1 ? options.labelKeys[i] : options.labelKey;
    return key ? { labelKey: key } : {};
  };
  const places: ImagePlace[] = ratios.map((ratio, i) => ({ ratio, minWidthPx, ...nameOf(i) }));
  if (options.lightbox) places.push({ ratio: 'original', minWidthPx: 0, ...(options.lightboxLabelKey ? { labelKey: options.lightboxLabelKey } : {}), lightbox: true });
  return { formats, places, source };
}

// Die abgeleitete Bild-ID gehört zum reinen Teil: Das Schema-Formular bildet und zerlegt sie im Browser.
export { derivedAssetId, parseDerivedAssetId, type CropRect } from './derived-id';
