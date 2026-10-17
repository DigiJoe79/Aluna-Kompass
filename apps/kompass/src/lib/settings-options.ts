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

/** Die Zeitzonen der Laufzeit; ein gespeicherter Wert, den sie nicht kennt (z. B. `UTC`), steht vorn. */
export function timeZoneOptions(current: string | null): SettingsOption[] {
  const zones = Intl.supportedValuesOf('timeZone');
  const all = current && !zones.includes(current) ? [current, ...zones] : zones;
  return all.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }));
}
