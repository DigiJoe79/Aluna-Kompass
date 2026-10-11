export type OpenItemStateWord = 'open' | 'partlyPaid' | 'settled' | 'settledWithoutPayment';

/**
 * Die vier Zustandswörter einer offenen Zahlung (HANDOFF § 5.5): überfällig
 * nur, solange noch etwas offen ist. „Erledigt ohne Zahlung“ (Kenner
 * `cancelledAt`) sticht — ein teilweise bezahlter, dann erledigter Posten
 * bleibt trotzdem „erledigt ohne Zahlung“.
 */
export function openItemState(
  item: { amountCents: number; openCents: number; cancelledAt: string | null; dueOn: string | null },
  today: string,
): { word: OpenItemStateWord; overdue: boolean } {
  const word: OpenItemStateWord = item.cancelledAt !== null ? 'settledWithoutPayment' : item.openCents === 0 ? 'settled' : item.openCents < item.amountCents ? 'partlyPaid' : 'open';
  const overdue = (word === 'open' || word === 'partlyPaid') && item.dueOn !== null && item.dueOn < today;
  return { word, overdue };
}
