import { REVERSE_CHARGE_CODES } from '@kompass/module-finance/codes';
import { vatPeriodOf, vatTaxPointOn } from '@kompass/module-finance/vat-calendar';

/**
 * Der Satz unter der Buchungszeile bei § 13b und Erwerb (Plan E6a Task 11c, Board Umsatzsteuer 3a): Steuer, Satz,
 * Bemessungsgrundlage und der Zeitraum, in dem sie zählt — gerechnet wie der Dienst (`vat-calendar`, eine Quelle). Die
 * Sätze sind die von heute (Entscheidung 19); der Bericht (E6b) rechnet je Entstehungstag.
 */
export interface VatLineContext {
  taxation: 'smallBusiness' | 'regular';
  rates: { standard: number; reduced: number };
  periodKinds: Record<number, 'quarter' | 'month'>;
}

export interface ReverseChargeLineFacts {
  taxCents: number;
  ratePercent: number;
  baseCents: number;
  /** Der Zeitraum, in dem die Steuer zählt (Entstehung). */
  period: string;
  /** Der Zeitraum des Leistungsdatums, ohne Leistungsdatum `null`. */
  servicePeriod: string | null;
  /** Der Zeitraum der Buchung. */
  entryPeriod: string;
  /** Kleinunternehmer: die Steuer ist geschuldet, aber nicht als Vorsteuer abziehbar. */
  noInputTax: boolean;
}

export const isReverseChargeCode = (code: string | undefined | null): boolean => !!code && (REVERSE_CHARGE_CODES as readonly string[]).includes(code);

export function reverseChargeLineFacts(input: { amountCents: number; taxCode: string | undefined; rateKind: 'standard' | 'reduced'; entryDate: string; serviceDate: string | null; context: VatLineContext }): ReverseChargeLineFacts | null {
  const { taxCode, amountCents, entryDate, serviceDate, context } = input;
  if (!isReverseCharge(taxCode) || amountCents === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return null;
  const kindOf = (day: string) => context.periodKinds[Number(day.slice(0, 4))] ?? 'quarter';
  const keyOf = (day: string) => vatPeriodOf(day, kindOf(day)).key;
  const service = serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) ? serviceDate : null;
  const taxPoint = vatTaxPointOn({ taxCode, entryDate, serviceDate: service });
  const ratePercent = context.rates[input.rateKind];
  const baseCents = Math.abs(amountCents);
  return { taxCents: Math.round((baseCents * ratePercent) / 100), ratePercent, baseCents, period: keyOf(taxPoint), servicePeriod: service ? keyOf(service) : null, entryPeriod: keyOf(entryDate), noInputTax: context.taxation === 'smallBusiness' };
}

function isReverseCharge(code: string | undefined): code is (typeof REVERSE_CHARGE_CODES)[number] {
  return isReverseChargeCode(code);
}
