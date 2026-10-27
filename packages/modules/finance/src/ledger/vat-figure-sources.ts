/**
 * Die Quellen der Umsatzsteuer-Kennzahlen und ihre Einheit — rein, ohne Datenbank: auch die Fassungen der Formulare
 * (`reporting/vat-forms.ts`, in der Oberfläche) lesen von hier. In `ledger/`, weil die Berichtigung (N14) die
 * Kennzahlen vergleicht und `ledger/` `reporting/` nicht kennt.
 */
export type VatFigureSource =
  | 'amended'
  | 'ownStandardBase'
  | 'ownReducedBase'
  | 'exemptTurnover'
  | 'exemptCountedTurnover'
  | 'exemptNotCountedTurnover'
  | 'smallBusinessTurnover'
  | 'acquisitionStandardBase'
  | 'acquisitionReducedBase'
  | 'acquisitionTax'
  | 'rc13bEuBase'
  | 'rc13bEuTax'
  | 'rc13bOtherBase'
  | 'rc13bOtherTax'
  | 'inputTax'
  | 'inputTaxAcquisition'
  | 'inputTaxReverseCharge'
  | 'result';

/** Wie ELSTER den Wert nimmt: Bemessungsgrundlagen und Umsätze in vollen Euro, Steuer mit Cent, Kz 10 als Merker. */
export const VAT_FIGURE_UNITS: Readonly<Record<VatFigureSource, 'euro' | 'cents' | 'flag'>> = {
  amended: 'flag',
  ownStandardBase: 'euro',
  ownReducedBase: 'euro',
  exemptTurnover: 'euro',
  exemptCountedTurnover: 'euro',
  exemptNotCountedTurnover: 'euro',
  smallBusinessTurnover: 'euro',
  acquisitionStandardBase: 'euro',
  acquisitionReducedBase: 'euro',
  acquisitionTax: 'cents',
  rc13bEuBase: 'euro',
  rc13bEuTax: 'cents',
  rc13bOtherBase: 'euro',
  rc13bOtherTax: 'cents',
  inputTax: 'cents',
  inputTaxAcquisition: 'cents',
  inputTaxReverseCharge: 'cents',
  result: 'cents',
};

export const VAT_FIGURE_SOURCES: readonly VatFigureSource[] = Object.keys(VAT_FIGURE_UNITS) as VatFigureSource[];

/** Bemessungsgrundlage in vollen Euro, Cent abgeschnitten (Anleitung USt 1 E: „nur Beträge in vollen Euro“). */
export function euroBase(cents: number): number {
  return Math.trunc(cents / 100) + 0;
}

/**
 * N14 (Joe 2026-10-27): Weicht eine Kennzahl heute von der abgegebenen ab — so, wie ELSTER sie bekam (`VAT_FIGURE_UNITS`)?
 * Kz 10 zählt nicht. Eine Berichtigung verlangt § 153 Abs. 1 S. 1 Nr. 1 AO nur, wenn die Erklärung unrichtig ist; eine
 * Zeile, die sich ändert, ohne eine Kennzahl zu ändern (Leistungstag im selben Zeitraum, Storno und gleiche Buchung neu),
 * macht sie nicht unrichtig. Kz 48 (Umsätze nach § 19 Abs. 1) zählt auch nicht (Joe 2026-10-27): Sie ändert keine Steuer,
 * und § 153 AO verlangt die Berichtigung nur, wenn es zu einer Verkürzung von Steuern kommen kann.
 */
export function vatFiguresDiffer(filed: Readonly<Record<string, number>>, now: Readonly<Record<string, number>>): boolean {
  return VAT_FIGURE_SOURCES.some((source) => {
    const unit = VAT_FIGURE_UNITS[source];
    if (unit === 'flag' || source === 'smallBusinessTurnover') return false;
    const a = filed[source] ?? 0;
    const b = now[source] ?? 0;
    return unit === 'euro' ? euroBase(a) !== euroBase(b) : a !== b;
  });
}
