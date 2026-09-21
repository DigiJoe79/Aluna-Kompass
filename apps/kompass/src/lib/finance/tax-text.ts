/**
 * Der Satz zur berechneten Steuer einer Aufteilungszeile (Finanz-Spec 5.4,
 * F3a-N Task 4): „darin … Umsatzsteuer“ für eine geschuldete Ausgangssteuer,
 * „Sie schulden … Umsatzsteuer (§ 13b) — auch als Kleinunternehmer“ für die
 * Reverse-Charge-Steuer. Ein gemeinsamer Helfer, damit Ansicht und Maske
 * denselben Text zeigen, nie zwei eigene.
 */
export interface TaxLike {
  outputTaxCents: number;
  reverseChargeTaxCents: number;
  inputTaxCents: number;
  inputTaxMemoCents: number;
  netCents: number;
}

export function taxTextKey(tax: TaxLike | null): { key: 'included' | 'reverseCharge'; cents: number } | null {
  if (!tax) return null;
  if (tax.outputTaxCents !== 0) return { key: 'included', cents: tax.outputTaxCents };
  if (tax.reverseChargeTaxCents !== 0) return { key: 'reverseCharge', cents: tax.reverseChargeTaxCents };
  return null;
}
