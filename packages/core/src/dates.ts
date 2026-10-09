/**
 * Ein Datum, zwei Wege (K10 Charge 1; vorher Befund 8, 2026-09-12: Listen zeigten ISO, Notizen deutsch).
 *
 * - Bildschirm: `formatDate`/`formatDateTime` nach der Einstellung `ui.dateFormat` (Prinzip 2) —
 *   „aus der Sprache“, bei Deutsch 12.09.2026, oder ISO 8601. Dienste schreiben ihre Meldungen über
 *   `messageDate`/`messageDateTime` (`message-date.ts`), die dieselbe Einstellung lesen.
 * - Papier: `paperDate`, fest TT.MM.JJJJ, und nur für einen Kalendertag (`IsoDay`). Ein Brief geht nach
 *   außen, die Zuwendungsbestätigung folgt dem amtlichen Muster, und ein festgeschriebenes Dokument darf
 *   sich nicht ändern, weil später jemand die Anzeige umstellt. Ein Zeitstempel kommt nur über den
 *   Vereinstag (`isoDayIn`, `todayIn`) aufs Papier — sonst druckt ein Brief von 0:30 Uhr den Vortag
 *   (Entscheidung Joe 2026-10-07). Schriftstücke sind vorerst nur deutsch; kommt eine zweite Sprache,
 *   bekommt `paperDate` die Dokumentsprache — nie `ui.dateFormat`.
 *
 * Gespeichert und verglichen wird ISO; formatiert wird nur, was ein Mensch liest. Rein, ohne Import:
 * Client-Komponenten laden die Datei über `@kompass/core/dates` (`apps/kompass/src/lib/dates.ts`).
 */
export type DateFormatMode = 'locale' | 'iso';

/**
 * Die Sprache der Datumsanzeige. Die Oberfläche reicht `formatDate` keine eigene durch
 * (`DateFormatProvider`, Seiten), also gilt diese; `messageDate` nimmt dieselbe.
 */
export const UI_DATE_LOCALE = 'de-DE';

/** Vorgabe, bis der Verein eine andere Zeitzone einträgt (`organization.timeZone`) — hier, damit die Oberfläche sie ohne Kern-Import kennt. */
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

declare const isoDayBrand: unique symbol;
/** Ein Kalendertag `JJJJ-MM-TT` — kein Zeitstempel. Entsteht nur über `isoDay`, `isIsoDay`, `isoDayInZone`, `isoDayIn`, `todayIn`. */
export type IsoDay = string & { readonly [isoDayBrand]: true };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Ist `value` ein Tag, den es im Kalender gibt (`2026-02-30` nicht)? */
export function isIsoDay(value: string): value is IsoDay {
  if (!DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/** Ein Kalendertag aus einem gespeicherten Wert; wirft bei allem anderen, auch bei einem Zeitstempel. */
export function isoDay(value: string): IsoDay {
  if (!isIsoDay(value)) throw new Error(`kein ISO-Tag (JJJJ-MM-TT): ${value}`);
  return value;
}

/**
 * Der Kalendertag eines Zeitpunkts in `timeZone`, als `JJJJ-MM-TT`. Die ersten zehn Zeichen eines
 * Zeitstempels sind der UTC-Tag — zwischen Mitternacht und ein bzw. zwei Uhr deutscher Zeit noch gestern.
 * Dienste nehmen `isoDayIn(deps, …)` (`today.ts`), das hier mit der Zone des Vereins rechnet.
 */
export function isoDayInZone(instant: Date | number, timeZone: string): IsoDay {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}` as IsoDay;
}

/**
 * Ein ISO-Datum (`2026-09-12`) oder ein ISO-Zeitstempel als Datum. Ein reiner Tag bleibt, wie er ist;
 * ein Zeitstempel wird zum Tag in `timeZone`, der Zone des Vereins (`timeZoneOf`, auf der Oberfläche
 * über `useDateFormat`) — nie zum UTC-Tag.
 */
export function formatDate(value: string | null | undefined, mode: DateFormatMode, timeZone: string, locale = UI_DATE_LOCALE): string {
  if (!value) return '';
  let day = value;
  if (!DATE_ONLY.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value;
    day = isoDayInZone(instant, timeZone);
  }
  if (mode === 'iso') return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

/** Zusatz für `formatDateTime`. `seconds` nur im Protokoll — zum Abgleich mit Serverprotokollen und Backups (MUSTER § Datum). */
export type DateTimeOptions = { seconds?: boolean };

/** Ein ISO-Zeitstempel als Datum mit Uhrzeit, in der Zeitzone des Vereins. */
export function formatDateTime(
  value: string | null | undefined,
  mode: DateFormatMode,
  timeZone: string,
  locale = UI_DATE_LOCALE,
  { seconds = false }: DateTimeOptions = {},
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const second = seconds ? ({ second: '2-digit' } as const) : {};
  if (mode === 'iso') {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...second }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}${seconds ? `:${get('second')}` : ''}`;
  }
  // Sekunden aus derselben Formatierung: Bei einem Format mit Zusatz nach der Uhrzeit stünden angehängte falsch.
  return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...second }).format(date);
}

function toInstant(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/**
 * Nur die Uhrzeit, fest `HH:mm` in 24 Stunden, in der Zone des Vereins — für Zeiten eines laufenden
 * Vorgangs (Veröffentlichen). Hängt nicht an `ui.dateFormat`; wird die Oberfläche englisch, ist das neu zu
 * entscheiden (Spec K10 Charge 2, § 2.1).
 */
export function formatTime(value: string | Date | null | undefined, timeZone: string): string {
  if (!value) return '';
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * „Gespeichert um …“: am selben Vereinstag wie `now` nur `HH:mm`, sonst Datum und Uhrzeit. Eine Uhrzeit
 * allein ist nur am selben Tag eindeutig. Keine relative Form; ein Zeitpunkt kurz nach `now` (Uhren von
 * Server und Browser laufen auseinander) zählt nach seinem Tag.
 */
export function formatStamp(value: string | Date | null | undefined, mode: DateFormatMode, timeZone: string, now: Date | number): string {
  if (!value) return '';
  const date = toInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (isoDayInZone(date, timeZone) === isoDayInZone(now, timeZone)) return formatTime(date, timeZone);
  return formatDateTime(date.toJSON(), mode, timeZone);
}

/**
 * Das Datum auf Papier: fest TT.MM.JJJJ, ohne `Intl`, damit ein PDF nicht an der ICU-Fassung hängt.
 * Ersetzt seit K10 `formatGermanDate` (documents) und die beiden `germanDate` (finance).
 */
export function paperDate(day: IsoDay): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}
