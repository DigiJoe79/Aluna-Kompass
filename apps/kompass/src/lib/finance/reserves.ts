/**
 * E4 „Zurückgelegtes Geld“ (F8b Task 6b, Designer-README 4d): die kleine
 * Rechnung für den Satz „Danach: Bestand …“ im Vorgang-Dialog. Die
 * maßgebliche Prüfung (Bestand am Vorgangstag, Reihenfolge) macht der Dienst.
 */
export type ReserveMovementKind = 'allocate' | 'withdraw' | 'dissolve';

/** Reihenfolge der Arten wie im Design: Projekt- und Betriebsmittel · Wiederbeschaffung · freie Rücklage · Beteiligung. */
export const RESERVE_KINDS = ['projectFunds', 'replacement', 'free', 'participation'] as const;
export type ReserveKind = (typeof RESERVE_KINDS)[number];

export function reserveBalanceAfter(balanceCents: number, kind: ReserveMovementKind, amountCents: number | null): number {
  if (kind === 'dissolve') return 0;
  const amount = amountCents ?? 0;
  return kind === 'allocate' ? balanceCents + amount : balanceCents - amount;
}
