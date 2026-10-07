import { DEFAULT_TIME_ZONE, isoDayInZone, type IsoDay } from './dates';
import type { Deps } from './deps';
import { readSetting } from './settings/service';

/** Vorgabe, bis der Verein eine andere Zeitzone einträgt — und für Deps ohne Kern-Einstellungen. */
export { DEFAULT_TIME_ZONE };

/** Ob `zone` eine IANA-Zeitzone ist, die die Laufzeit kennt. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Die Zeitzone des Vereins (`organization.timeZone`). */
export function timeZoneOf(deps: Pick<Deps, 'db' | 'registry'>): string {
  if (!deps.registry.settingDefinitions.has('organization.timeZone')) return DEFAULT_TIME_ZONE;
  return readSetting<string>(deps as Deps, 'organization.timeZone');
}

/**
 * Der Kalendertag eines Zeitpunkts in der Zeitzone des Vereins, als `YYYY-MM-DD`.
 * A4: Die ersten zehn Zeichen von `toISOString()` sind der UTC-Tag — zwischen Mitternacht und
 * ein bzw. zwei Uhr deutscher Zeit noch gestern, und „heute“ läge in der Zukunft.
 */
export function isoDayIn(deps: Pick<Deps, 'db' | 'registry'>, instant: Date | number): IsoDay {
  return isoDayInZone(instant, timeZoneOf(deps));
}

/** „Heute“ im Sinne des Vereins: der Kalendertag von `deps.clock.now()` in seiner Zeitzone. */
export function todayIn(deps: Pick<Deps, 'db' | 'registry' | 'clock'>): IsoDay {
  return isoDayIn(deps, deps.clock.now());
}

/**
 * Das laufende Jahr im Sinne des Vereins — für Nummernkreise (`RCH-2027-001`)
 * und Jahresauswahlen. Befund 46: `getUTCFullYear()` lieferte am 1.1. zwischen
 * Mitternacht und ein Uhr noch das alte Jahr, zu einem Datum im neuen.
 */
export function yearIn(deps: Pick<Deps, 'db' | 'registry' | 'clock'>): number {
  return Number(todayIn(deps).slice(0, 4));
}
