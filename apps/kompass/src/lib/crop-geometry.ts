/**
 * Rechnen am Bildausschnitt eines Tierfotos, ohne Oberfläche (Plan B Task 1, Handover `design_handoff_ausschnitt`).
 *
 * Alles in Anteilen am Original (`x, y, w, h` von 0 bis 1, nach EXIF-Drehung) wie `animal_photos.crop`. Das
 * Seitenverhältnis gilt in Pixeln: `(w · width) / (h · height) = aspect`. Zoom 1 ist das größtmögliche Rechteck im
 * Format, `MAX_ZOOM` (1,9) das kleinste — harte Grenze für Griffe, Finger, Schieber und Tasten.
 */

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Original in Pixeln und Zielformat als Zahl (Breite / Höhe, `aspectOf('4:5')` = 0,8). */
export interface CropGeometry {
  width: number;
  height: number;
  aspect: number;
}
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const MAX_ZOOM = 1.9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `'4:5'` → 0,8. */
export function aspectOf(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return w! / h!;
}

/** Größtes Rechteck im Format (Zoom 1), als Anteile. */
function maxSize(g: CropGeometry): { w: number; h: number } {
  return g.width / g.height >= g.aspect ? { w: (g.aspect * g.height) / g.width, h: 1 } : { w: 1, h: g.width / (g.aspect * g.height) };
}

/** Höhe zur Breite, exakt im Format. */
const heightFor = (w: number, g: CropGeometry) => (w * g.width) / (g.height * g.aspect);

/** Rechteck der Breite `w` um den Mittelpunkt, ins Bild gerückt. */
function around(cx: number, cy: number, w: number, g: CropGeometry): Crop {
  const h = heightFor(w, g);
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/**
 * Start ohne Ausschnitt: größtmöglich am Blickpunkt — genau das, was `object-fit: cover; object-position: X% Y%`
 * heute zeigt. „Übernehmen“ ohne Bewegung legt also fest, was die Webseite schon zeigt.
 */
export function initialCrop(g: CropGeometry, focus: { focusX: number; focusY: number }): Crop {
  const { w, h } = maxSize(g);
  return { x: ((1 - w) * focus.focusX) / 100, y: ((1 - h) * focus.focusY) / 100, w, h };
}

/** Seitenverhältnis eines Ausschnitts in Pixeln. */
export function formatOf(crop: Crop, g: Pick<CropGeometry, 'width' | 'height'>): number {
  return (crop.w * g.width) / (crop.h * g.height);
}

/** Formatwechsel: das größte Rechteck im neuen Format, mittig im alten. Der gespeicherte Ausschnitt bleibt, bis man übernimmt. */
export function fitToFormat(crop: Crop, g: CropGeometry): Crop {
  const cw = crop.w * g.width;
  const ch = crop.h * g.height;
  const w = cw / ch >= g.aspect ? (g.aspect * ch) / g.width : crop.w;
  return around(crop.x + crop.w / 2, crop.y + crop.h / 2, w, g);
}

/** Zoom gegenüber dem größtmöglichen Rechteck (1 = größtmöglich). */
export function zoomOf(crop: Crop, g: CropGeometry): number {
  return maxSize(g).w / crop.w;
}

/** Größe auf einen Zoom setzen, um die Mitte; der Zoom bleibt zwischen 1 und `maxZoom`. */
export function setZoom(crop: Crop, g: CropGeometry, zoom: number, maxZoom = MAX_ZOOM): Crop {
  const z = clamp(zoom, 1, maxZoom);
  return around(crop.x + crop.w / 2, crop.y + crop.h / 2, maxSize(g).w / z, g);
}

/** Tasten `+`/`−` und Knöpfe am Schieber: Zoom um `delta` ändern, um die Mitte. */
export function resizeAroundCenter(crop: Crop, g: CropGeometry, delta: number, maxZoom = MAX_ZOOM): Crop {
  return setZoom(crop, g, zoomOf(crop, g) + delta, maxZoom);
}

/** Verschieben um Anteile am Bild; das Rechteck bleibt im Bild. */
export function moveBy(crop: Crop, _g: CropGeometry, dx: number, dy: number): Crop {
  return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.w), y: clamp(crop.y + dy, 0, 1 - crop.h) };
}

/**
 * Ziehen an einer Ecke: Die Gegenecke steht fest, das Rechteck reicht bis zum Zeiger (die größere der beiden
 * Richtungen gewinnt), höchstens bis zum Bildrand, nie kleiner als bei `maxZoom`. Über die Gegenecke hinaus
 * bleibt es klein, es klappt nicht um.
 */
export function resizeFromCorner(crop: Crop, g: CropGeometry, corner: Corner, point: { x: number; y: number }, maxZoom = MAX_ZOOM): Crop {
  const east = corner === 'ne' || corner === 'se';
  const south = corner === 'sw' || corner === 'se';
  const ax = east ? crop.x : crop.x + crop.w;
  const ay = south ? crop.y : crop.y + crop.h;
  const dxPx = Math.max(0, (east ? point.x - ax : ax - point.x) * g.width);
  const dyPx = Math.max(0, (south ? point.y - ay : ay - point.y) * g.height);
  const maxPx = maxSize(g).w * g.width;
  const availPx = Math.min((east ? 1 - ax : ax) * g.width, (south ? 1 - ay : ay) * g.height * g.aspect, maxPx);
  const wPx = clamp(Math.max(dxPx, dyPx * g.aspect), maxPx / maxZoom, availPx);
  const w = wPx / g.width;
  const h = heightFor(w, g);
  return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h };
}

/**
 * Zwei Finger: `scale` ist das Verhältnis der Fingerabstände (jetzt / vorher). Spreizen vergrößert wie bei jedem
 * Foto — der Ausschnitt wird kleiner, der Zoom größer —, und zwar um den Mittelpunkt der Finger.
 */
export function pinch(crop: Crop, g: CropGeometry, center: { x: number; y: number }, scale: number, maxZoom = MAX_ZOOM): Crop {
  const max = maxSize(g).w;
  const w = clamp(crop.w / scale, max / maxZoom, max);
  const f = w / crop.w;
  const h = heightFor(w, g);
  return { x: clamp(center.x - (center.x - crop.x) * f, 0, 1 - w), y: clamp(center.y - (center.y - crop.y) * f, 0, 1 - h), w, h };
}

/** Taste `0`, Knopf „Ganzes Format“: größtmöglich um den aktuellen Mittelpunkt. */
export function fullFormat(crop: Crop, g: CropGeometry): Crop {
  return around(crop.x + crop.w / 2, crop.y + crop.h / 2, maxSize(g).w, g);
}

export function cropPixelWidth(crop: Crop, width: number): number {
  return Math.round(crop.w * width);
}
export function cropPixelHeight(crop: Crop, height: number): number {
  return Math.round(crop.h * height);
}

/**
 * Vier Nachkommastellen wie `roundCrop` des Tiermoduls. Nachgebaut, weil diese Datei im Browser läuft und das
 * Modul Server-Code ist; `tests/crop-geometry.test.ts` hält beide gleich.
 */
export const roundCrop = (c: Crop): Crop => ({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4) });

/** Ein Format als „4:5“: das kleinste ganzzahlige Paar innerhalb 1 %; sonst die Zahl. */
export function aspectLabel(ratio: number): string {
  for (let h = 1; h <= 20; h++) {
    const w = Math.round(ratio * h);
    if (w > 0 && Math.abs(w / h / ratio - 1) <= 0.01) return `${w}:${h}`;
  }
  return ratio.toFixed(2);
}

/** Lage in Dritteln aus dem Mittelpunkt, für `aria-valuetext` („Mitte links“). */
export function positionOf(crop: Crop): { v: 'top' | 'middle' | 'bottom'; h: 'left' | 'center' | 'right' } {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return { v: cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle', h: cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center' };
}

/**
 * Formate für alle Bilder (Handover `HANDOFF-alle-bilder.md` 1, Datenmodell). Ein Format ist `'W:H'` oder `'original'`
 * — das Seitenverhältnis des Bilds selbst. Gespeichert wird nur das Rechteck; die Wahl leitet `matchFormat` beim
 * Öffnen ab.
 */
export type Orientation = 'landscape' | 'portrait';

/** Seitenverhältnis eines Formats als Zahl; `'original'` ist das des Bilds. */
export function ratioValue(ratio: string, width: number, height: number): number {
  return ratio === 'original' ? width / height : aspectOf(ratio);
}

const LANDSCAPE_ROW = ['original', '1:1', '4:3', '3:2', '16:9'] as const;
const swap = (ratio: string) => (ratio === 'original' ? ratio : ratio.split(':').reverse().join(':'));

/** Die volle Reihe: quer Original, 1:1, 4:3, 3:2, 16:9; hoch dieselben gedreht (3:4, 2:3, 9:16). */
export function formatRow(orientation: Orientation): string[] {
  return orientation === 'landscape' ? [...LANDSCAPE_ROW] : LANDSCAPE_ROW.map(swap);
}

/** Hoch ist, was höher als breit ist; 1:1 und Original zählen als quer (der Umschalter ist dort aus). */
export function orientationOf(ratio: string): Orientation {
  if (ratio === 'original') return 'landscape';
  return aspectOf(ratio) < 1 ? 'portrait' : 'landscape';
}

/**
 * Die Wahl beim Öffnen: ohne Ausschnitt das erste erlaubte Format (volle Reihe: „Original“); mit Ausschnitt das
 * passende innerhalb 1 % (Original vor einem gleichen Verhältnis), sonst das nächstliegende — `exact: false`, dann
 * passt der Dialog das Rechteck an und sagt es (Formatwechsel).
 */
export function matchFormat(crop: Crop | null, width: number, height: number, formats: readonly string[]): { ratio: string; exact: boolean } {
  const allowed = formats.length > 0 ? [...formats] : [...formatRow('landscape'), ...formatRow('portrait').filter((r) => !LANDSCAPE_ROW.includes(r as never))];
  if (!crop) return { ratio: allowed[0]!, exact: true };
  const actual = formatOf(crop, { width, height });
  const distance = (r: string) => Math.abs(Math.log(actual / ratioValue(r, width, height)));
  const exact = allowed.find((r) => distance(r) <= Math.log(1.01));
  if (exact) return { ratio: exact, exact: true };
  const nearest = allowed.reduce((best, r) => (distance(r) < distance(best) ? r : best));
  return { ratio: nearest, exact: false };
}

/** Wo eine Stelle im Format `place` ein Rechteck im Format `chosen` nachschneidet (1 % Toleranz). */
export function trimOf(chosen: number, place: number): 'sides' | 'topBottom' | null {
  if (Math.abs(chosen / place - 1) <= 0.01) return null;
  return chosen > place ? 'sides' : 'topBottom';
}
