import type { CsvFormat } from './format';

export type BuiltinFormatKey = string;

/**
 * Mitgelieferte CSV-Formate, erkannt an der Kopfzeile. In F4b bewusst leer
 * (Joe, 2026-09-23): Ein Zahlungsdienst-Format kommt erst, wenn ein echter
 * Export vorliegt — beim PayPal-Aktivitäten-CSV wählt man die Spalten beim
 * Herunterladen selbst, eine feste Kopfzeile träfe oft nicht.
 */
export const BUILTIN_FORMATS: Record<BuiltinFormatKey, { label: string; format: CsvFormat }> = {};
