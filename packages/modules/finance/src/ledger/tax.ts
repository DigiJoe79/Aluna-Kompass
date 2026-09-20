import type { TAX_CODES } from './codes';

export type Taxation = 'smallBusiness' | 'regular';
export type TaxCode = (typeof TAX_CODES)[number];

export interface TaxInput {
  amountCents: number;
  taxCode: TaxCode;
  rateKind: 'standard' | 'reduced';
  taxation: Taxation;
  inputTaxDeductible: 'no' | 'yes' | 'partial';
  rates: { standard: number; reduced: number };
}

export interface TaxResult {
  /** Geschuldet aus eigenen Umsätzen — nur unter `regular`. */
  outputTaxCents: number;
  /** Geschuldet nach § 13b / innergemeinschaftlichem Erwerb — in beiden Besteuerungsformen. */
  reverseChargeTaxCents: number;
  /** Abziehbar — nur unter `regular` und Kategorie „yes“. */
  inputTaxCents: number;
  /** Nur nachrichtlich (Kategorie „partial“). */
  inputTaxMemoCents: number;
  /** Vorzeichen wie `amountCents`. */
  netCents: number;
}

/** Steuer aus einem Bruttobetrag ohne Vorzeichen: Brutto − round(Brutto × 100 / (100 + Satz)). */
function taxFromGross(grossCents: number, ratePercent: number): number {
  return grossCents - Math.round((grossCents * 100) / (100 + ratePercent));
}

/** Steuer aus einem Nettobetrag ohne Vorzeichen (§ 13b / ig. Erwerb: Brutto = Netto). */
function taxFromNet(netCents: number, ratePercent: number): number {
  return Math.round((netCents * ratePercent) / 100);
}

/**
 * Reine Steuerrechnung, ohne Datenbank (Finanz-Spec 5.2). Gespeichert wird
 * immer nur Brutto und Kennzeichen; die Steuer ist **berechnet**, nie
 * gespeichert — so bleibt eine Buchung richtig, auch wenn der Verein die
 * Besteuerungsform nachträglich mit dem richtigen Stichtag einträgt.
 */
export function taxOf(input: TaxInput): TaxResult {
  const { amountCents, taxCode, rateKind, taxation, inputTaxDeductible, rates } = input;
  const gross = Math.abs(amountCents);
  const sign = amountCents < 0 ? -1 : 1;

  let outputTaxCents = 0;
  let reverseChargeTaxCents = 0;
  let inputTaxCents = 0;
  let inputTaxMemoCents = 0;
  let netAbs = gross;

  if (taxCode === 'reduced' || taxCode === 'standard') {
    // Satz aus dem Kennzeichen selbst — `rateKind` gilt hier nicht.
    if (taxation === 'regular') {
      const rate = rates[taxCode];
      const taxCents = taxFromGross(gross, rate);
      netAbs = gross - taxCents;
      if (amountCents > 0) {
        outputTaxCents = taxCents;
      } else if (amountCents < 0) {
        if (inputTaxDeductible === 'yes') inputTaxCents = taxCents;
        else if (inputTaxDeductible === 'partial') inputTaxMemoCents = taxCents;
      }
    }
    // `smallBusiness`: das Kennzeichen dient nur dem Schwellenwächter — keine Steuer, Netto = Zeilenbetrag.
  } else if (taxCode === 'rc13b' || taxCode === 'icAcquisition') {
    // Brutto = Netto; die Steuer wird in BEIDEN Besteuerungsformen geschuldet (§ 13b Abs. 5 UStG).
    const rate = rates[rateKind];
    reverseChargeTaxCents = taxFromNet(gross, rate);
    if (taxation === 'regular') {
      if (inputTaxDeductible === 'yes') inputTaxCents = reverseChargeTaxCents;
      else if (inputTaxDeductible === 'partial') inputTaxMemoCents = reverseChargeTaxCents;
    }
  }
  // `none`, `exemptCounted`, `exemptNotCounted`: alles 0, Netto = Zeilenbetrag.

  return { outputTaxCents, reverseChargeTaxCents, inputTaxCents, inputTaxMemoCents, netCents: sign * netAbs };
}
