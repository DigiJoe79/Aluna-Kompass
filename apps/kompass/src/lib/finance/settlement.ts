/**
 * Reine Funktionen der Zahlungszuordnung an einer Geldzeile
 * (Finanz-Spec 5.3, F3a-N Task 5): Vorschlag für den Teilbetrag, und welche
 * Richtung einer Geldzeile zu welcher Art offenem Posten passt.
 */

/** min(offener Rest, was die Geldzeile noch frei hat), nie negativ. */
export function suggestSettlementCents(args: { openCents: number; lineCents: number; alreadySettledCents: number }): number {
  const remainingLine = args.lineCents - args.alreadySettledCents;
  return Math.max(0, Math.min(args.openCents, remainingLine));
}

/** Ausgang → Verbindlichkeit, Eingang → Forderung. */
export function matchesDirection(itemKind: 'receivable' | 'payable', direction: 'in' | 'out'): boolean {
  return itemKind === 'receivable' ? direction === 'in' : direction === 'out';
}
