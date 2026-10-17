/**
 * Auswahllisten für Land und Zeitzone der Vereinseinstellungen (11-1 B19): Klarnamen in der Anzeige, gespeichert
 * bleibt der Code (`organization.country` zwei Buchstaben, `organization.timeZone` IANA).
 */
export interface SettingsOption {
  value: string;
  label: string;
}

/** Codes, die `Intl.DisplayNames` kennt, die aber kein Land sind. */
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Alle Länder mit Namen in `locale`, nach Namen sortiert. Die Liste entsteht aus `Intl.DisplayNames` (ohne Rückfall). */
export function countryOptions(locale: string): SettingsOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
  const options: SettingsOption[] = [];
  for (const a of LETTERS) {
    for (const b of LETTERS) {
      const code = a + b;
      if (NOT_A_COUNTRY.has(code)) continue;
      const label = names.of(code);
      if (label) options.push({ value: code, label });
    }
  }
  return options.sort((x, y) => x.label.localeCompare(y.label, locale));
}

/** Ein fester Sommertag als Bezug: ICU nennt die allgemeine Zeit („Mitteleuropäische Zeit“) je nach Tag sonst auch
 *  „… Normalzeit“. Nur der Name wird gelesen, kein Datum angezeigt. */
const ZONE_NAME_REFERENCE = Date.UTC(2000, 6, 1);

/** „Berlin (Mitteleuropäische Zeit)“: der Ort aus dem letzten Teil des IANA-Namens, die Zeit über `Intl` (Runde 3, 149). */
function zoneLabel(zone: string, locale: string): string {
  const city = zone.split('/').pop()!.replaceAll('_', ' ');
  if (!zone.includes('/')) return city;
  const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(ZONE_NAME_REFERENCE)
    .find((part) => part.type === 'timeZoneName')?.value;
  return name ? `${city} (${name})` : city;
}

/** Die Zeitzonen der Laufzeit mit Ort und Zeit, nach Namen sortiert; ein gespeicherter Wert, den sie nicht kennt
 *  (z. B. `UTC`), steht vorn. Gespeichert bleibt der IANA-Name. */
export function timeZoneOptions(current: string | null, locale: string): SettingsOption[] {
  const zones = Intl.supportedValuesOf('timeZone');
  const known = zones.map((zone) => ({ value: zone, label: zoneLabel(zone, locale) })).sort((x, y) => x.label.localeCompare(y.label, locale));
  return current && !zones.includes(current) ? [{ value: current, label: zoneLabel(current, locale) }, ...known] : known;
}

/**
 * Vorschläge für eine neue Sprache (Runde 3, 180): alle zweibuchstabigen Sprachcodes, die `Intl.DisplayNames` kennt,
 * als „Französisch (fr)“, ohne die schon vorhandenen, nach Namen sortiert. Gespeichert wird der Code; ein freier
 * Code (BCP-47, etwa `pt-br`) bleibt im Feld möglich.
 */
export function languageOptions(locale: string, existing: readonly string[]): SettingsOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' });
  const options: SettingsOption[] = [];
  for (const a of LETTERS.toLowerCase()) {
    for (const b of LETTERS.toLowerCase()) {
      const code = a + b;
      if (existing.includes(code)) continue;
      const name = names.of(code);
      if (name && name !== code) options.push({ value: code, label: `${name} (${code})` });
    }
  }
  return options.sort((x, y) => x.label.localeCompare(y.label, locale));
}
