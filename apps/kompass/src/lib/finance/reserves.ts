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

export type ReserveSaveBlocker = 'amount' | 'date' | 'resolution' | 'resolutionTwice';

/**
 * Was dem Vorgang oder Vortrag noch fehlt, damit gespeichert werden kann — das erste in der Reihenfolge der Maske. Der
 * gesperrte Knopf nennt es (Runde 3, 124/125; MUSTER § B: der Grund steht als Text neben dem Knopf). `documents` zählt
 * Beschlüsse aus Akte und Upload; beides zugleich geht nicht.
 */
export function reserveSaveBlocker({ amountOk, date, documents }: { amountOk: boolean; date: string; documents: number }): ReserveSaveBlocker | null {
  if (!amountOk) return 'amount';
  if (!date) return 'date';
  if (documents === 0) return 'resolution';
  if (documents > 1) return 'resolutionTwice';
  return null;
}
