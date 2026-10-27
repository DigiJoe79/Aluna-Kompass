import { REVERSE_CHARGE_CODES } from './codes';
import type { TaxCode } from './tax';

/** Die Länder für „Bundesland des Finanzamts“ (Feiertage, `working-days.ts`) — auch für die Auswahl im Browser. */
export { FEDERAL_STATES, type FederalState } from './working-days';

/**
 * Umsatzsteuer-Zeiträume ohne Datenbank (Plan E6a Task 11a): Entstehungstag, Zeitraum eines Tages, Schlüssel lesen.
 * Rein, damit Buchungsmaske und Korrekturdialog den Zeitraum im Browser genauso rechnen wie der Dienst
 * (`@kompass/module-finance/vat-calendar`) — eine Quelle. `vat-periods.ts` exportiert sie weiter.
 */

const isReverseCharge = (code: string): boolean => (REVERSE_CHARGE_CODES as readonly string[]).includes(code);

/**
 * Der Tag, an dem die Steuer der Zeile entsteht. § 13b/Erwerb: mit Ablauf des Zeitraums der Leistung (§ 13b Abs. 1,
 * Abs. 2 UStG; beim Drittland mit der Rechnung — das Feld trägt dann das Rechnungsdatum), bei Zahlung vor der Leistung
 * mit der Zahlung (§ 13b Abs. 4 S. 2 UStG): also der frühere von Leistungs- und Buchungstag. Alle übrigen Kennzeichen
 * nach dem Buchungstag (Ist-Versteuerung).
 */
export function vatTaxPointOn(line: { taxCode: TaxCode; entryDate: string; serviceDate: string | null }): string {
  if (!isReverseCharge(line.taxCode)) return line.entryDate;
  const service = line.serviceDate ?? line.entryDate;
  return service < line.entryDate ? service : line.entryDate;
}

export type VatPeriodKind = 'quarter' | 'month';
export interface VatPeriodRange { key: string; kind: VatPeriodKind | 'year'; startsOn: string; endsOn: string }

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function monthRange(year: number, firstMonth: number, months: number): { startsOn: string; endsOn: string } {
  const lastMonth = firstMonth + months - 1;
  return { startsOn: `${year}-${pad(firstMonth)}-01`, endsOn: `${year}-${pad(lastMonth)}-${pad(lastDayOf(year, lastMonth))}` };
}

/** Der Voranmeldungszeitraum, in dem ein Tag liegt: `'YYYY-Qn'` oder `'YYYY-MM'`. */
export function vatPeriodOf(date: string, kind: VatPeriodKind): VatPeriodRange {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (kind === 'month') return { key: `${year}-${pad(month)}`, kind, ...monthRange(year, month, 1) };
  const quarter = Math.ceil(month / 3);
  return { key: `${year}-Q${quarter}`, kind, ...monthRange(year, quarter * 3 - 2, 3) };
}

/** Ein Schlüssel `'YYYY'`, `'YYYY-Qn'` oder `'YYYY-MM'` als Zeitraum; sonst `null`. */
export function parseVatPeriod(key: string): VatPeriodRange | null {
  const match = /^(\d{4})(?:-Q([1-4])|-(0[1-9]|1[0-2]))?$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  if (match[2]) return vatPeriodOf(`${year}-${pad(Number(match[2]) * 3)}-01`, 'quarter');
  if (match[3]) return vatPeriodOf(`${year}-${match[3]}-01`, 'month');
  return { key: String(year), kind: 'year', startsOn: `${year}-01-01`, endsOn: `${year}-12-31` };
}

/**
 * Der erste Tag, an dem die Abgabe eines Zeitraums eingetragen werden kann: der Tag nach seinem Ende — davor lehnt der
 * Dienst sie ab (`beforePeriodEnd`). Rein, damit Fristenliste und Umsatzsteuer-Seite statt eines sicher abgelehnten
 * Knopfs „Abgabe ab …“ zeigen (Befund 0.4.0/33). Unbekannter Schlüssel → `null`.
 */
export function vatFilingOpensOn(key: string): string | null {
  const range = parseVatPeriod(key);
  if (!range) return null;
  // Jeder Zeitraum endet am Monatsende: Der Tag danach ist der Erste des Folgemonats, ohne Rechnen mit `Date`.
  const year = Number(range.endsOn.slice(0, 4));
  const month = Number(range.endsOn.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
}
