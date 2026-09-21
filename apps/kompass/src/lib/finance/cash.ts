/** Stückelung des Euro (HANDOFF § 5.4): Scheine und Münzen, größter zuerst. */
export const DENOMINATIONS_CENTS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Stückzahlen je Nennwert (Cent → Anzahl) zum gezählten Betrag — negative oder leere Felder zählen nicht mit. */
export function sumDenominations(counts: Record<number, number>): number {
  let sum = 0;
  for (const [cents, count] of Object.entries(counts)) {
    if (!count || count <= 0) continue;
    sum += Number(cents) * count;
  }
  return sum;
}

export interface CountResult {
  kind: 'equal' | 'surplus' | 'shortage';
  differenceCents: number;
}

/** Buchbestand gegen gezählten Betrag — nennt gleich, Differenz oder Fehlbetrag mit dem absoluten Unterschied. */
export function countResult(bookCents: number, countedCents: number): CountResult {
  const differenceCents = countedCents - bookCents;
  const kind = differenceCents === 0 ? 'equal' : differenceCents > 0 ? 'surplus' : 'shortage';
  return { kind, differenceCents };
}
