/**
 * Aufbewahrungsklassen. Die Namen sind Code, weil Services sie benennen; die
 * Längen sind Einstellungen, weil ein Verein außerhalb Deutschlands anders
 * rechnet (Prinzip 2).
 */
export type RetentionClass = 'permanent' | 'statutory10Y' | 'statutory6Y' | 'consent';

export const RETENTION_CLASSES: readonly RetentionClass[] = ['permanent', 'statutory10Y', 'statutory6Y', 'consent'];

/**
 * Vorgabelängen in Monaten.
 * - `statutory10Y`: Belege, Zuwendungsbestätigungen, Jahresabschluss (§ 147 AO).
 * - `statutory6Y`: empfangene und abgesandte Geschäftsbriefe (§ 147 Abs. 3 AO).
 * - `consent`: ohne gesetzliche Grundlage — der Interessent, aus dem nichts wurde.
 * `permanent` fehlt hier: es wird nie fällig.
 */
export const RETENTION_DEFAULT_MONTHS: Record<Exclude<RetentionClass, 'permanent'>, number> = {
  statutory10Y: 120,
  statutory6Y: 72,
  consent: 24,
};

/**
 * Das Datum, an dem eine Aufbewahrung endet.
 *
 * Die Frist beginnt nicht am Ereignistag, sondern mit Ablauf des Kalenderjahres
 * (§ 147 Abs. 4 AO) — der 15.03.2026 und der 31.12.2026 laufen beide zum
 * 31.12.2036 ab. Endet die Frist in einem kürzeren Monat, gilt dessen letzter Tag.
 *
 * @param fromIso ISO-Datum oder -Zeitstempel; gelesen wird nur das Jahr.
 * @param months  Länge in Monaten, aus der Einstellung der Klasse.
 */
export function retentionEnd(fromIso: string, months: number): string {
  const year = Number(fromIso.slice(0, 4));
  const total = 11 + months; // Dezember (0-basiert 11) als Startmonat
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = total % 12; // 0-basiert
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
