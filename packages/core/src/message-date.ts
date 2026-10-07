import { formatDate, formatDateTime, UI_DATE_LOCALE, type DateFormatMode } from './dates';
import type { Deps } from './deps';
import { readSetting } from './settings/service';
import { timeZoneOf } from './today';

/**
 * Datum (und Uhrzeit) in Meldungstexten der Dienste — Ablehnungen, Hinweise, Protokoll-Zusammenfassungen
 * (K10 Charge 1, Spec § 2). Sie folgen der Anzeige-Einstellung `ui.dateFormat` und derselben Sprache wie
 * die Oberfläche (`UI_DATE_LOCALE`); die Uhrzeit steht in `organization.timeZone`. Papier (Typst, Betreffe
 * der Akte, Buchungstexte) nimmt `paperDate`.
 *
 * Immer absolut: Eine Protokollzeile bleibt stehen, „vor 3 Tagen“ wäre morgen falsch. Kommt je ein
 * relativer Anzeigemodus dazu, wird er hier `locale`.
 */
export function messageDateMode(stored: unknown): DateFormatMode {
  return stored === 'iso' ? 'iso' : 'locale';
}

function modeOf(deps: Pick<Deps, 'db' | 'registry'>): DateFormatMode {
  // Wie `timeZoneOf`: Eine Teil-Registry ohne Kern-Einstellungen fällt auf den Standard zurück.
  return messageDateMode(deps.registry.settingDefinitions.has('ui.dateFormat') ? readSetting<unknown>(deps as Deps, 'ui.dateFormat') : undefined);
}

export function messageDate(deps: Pick<Deps, 'db' | 'registry'>, iso: string | null | undefined): string {
  // Ein Zeitstempel wird zum Vereinstag — dieselbe Rechnung wie `isoDayIn`, nie der UTC-Tag.
  return formatDate(iso, modeOf(deps), timeZoneOf(deps), UI_DATE_LOCALE);
}

export function messageDateTime(deps: Pick<Deps, 'db' | 'registry'>, iso: string | null | undefined): string {
  return formatDateTime(iso, modeOf(deps), timeZoneOf(deps), UI_DATE_LOCALE);
}
