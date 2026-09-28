/**
 * Reine Rechnung des Höchstbetrags der freien Rücklage (F8b Annahme 4, § 62
 * Abs. 1 Nr. 3 AO) — **Näherung**, keine Sperre. Kein Import, damit sie im
 * Dienst (`allocation/reserves.ts`) wie im Client-Formular
 * (`src/lib/finance/reserves.ts`, Unterpfad-Export `./reserve-rules`) läuft
 * (Muster `evidence-rules.ts`). Liefert nur Zahlen — kein Zustandswort: das
 * ist Sache von `LimitProgress` (Annahme 17).
 */

export interface FreeReserveCapInput {
  /** Überschuss der Vermögensverwaltung im Jahr — ein Minus zählt als 0. */
  assetManagementSurplusCents: number;
  /** Bruttoeinnahmen des ideellen Bereichs ohne Zuwendungen zum Vermögen, plus positive Überschüsse aus Zweckbetrieb und Geschäftsbetrieb. */
  otherTimelyFundsCents: number;
  /** Anteil der Vermögensverwaltung in Prozent (Reihe `freeReserveAssetShare`, Vorgabe 33). */
  assetSharePercent: number;
  /** Anteil der übrigen Mittel in Prozent (Reihe `freeReserveOtherShare`, Vorgabe 10). */
  otherSharePercent: number;
}

/**
 * ⌊max(0, Überschuss Vermögensverwaltung) × Anteil⌋ + ⌊übrige zeitnah zu
 * verwendende Mittel × Anteil⌋ — ganzzahlig in Cent.
 */
export function freeReserveCapCents(input: FreeReserveCapInput): number {
  const assetPart = Math.floor((Math.max(0, input.assetManagementSurplusCents) * input.assetSharePercent) / 100);
  const otherPart = Math.floor((Math.max(0, input.otherTimelyFundsCents) * input.otherSharePercent) / 100);
  return assetPart + otherPart;
}
