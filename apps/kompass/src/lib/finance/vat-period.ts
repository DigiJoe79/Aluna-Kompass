/**
 * E6a: ein Umsatzsteuer-Zeitraum lesbar — `'2026-Q2'` → „2. Quartal 2026“, `'2026-05'` → „Mai 2026“, `'2026'` → „2026“.
 * Der Dienst liefert nur den Schlüssel (`vatPeriod` an den Fristen); die Oberfläche formatiert ihn, an einer Stelle für
 * Fristenliste und Kachel. `t` ist der Übersetzer ohne Namensraum.
 */
export type VatPeriodTranslator = (key: 'finance.vatPeriod.quarter' | 'finance.vatPeriod.month', values: Record<string, string>) => string;

export function vatPeriodLabel(period: string, t: VatPeriodTranslator): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter) return t('finance.vatPeriod.quarter', { quarter: quarter[2]!, year: quarter[1]! });
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (month) return t('finance.vatPeriod.month', { month: month[2]!, year: month[1]! });
  return period;
}

/** Die Werte eines Satzes mit lesbarem `vatPeriod` — für Fristenliste und Kachel. */
export function withVatPeriodLabel<V extends Record<string, unknown>>(values: V, t: VatPeriodTranslator): V {
  return typeof values.vatPeriod === 'string' ? { ...values, vatPeriod: vatPeriodLabel(values.vatPeriod, t) } : values;
}
