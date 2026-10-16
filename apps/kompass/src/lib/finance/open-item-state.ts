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

export const OPEN_ITEM_FILTER_STATES = ['open', 'settled', 'overpaid', 'cancelled'] as const;
export type OpenItemsStateFilter = (typeof OPEN_ITEM_FILTER_STATES)[number] | 'all';

/**
 * Der Zustandsfilter der offenen Zahlungen aus der Adresse (`?state=`, 07-2 A1, Joe 2026-10-16): ohne Angabe „offen“ —
 * Erledigtes steht nicht mehr unter „Wir zahlen“; `all` zeigt alles. Der Dienst filtert (`listOpenItems state`).
 */
export function openItemsStateFilter(param: string | undefined): OpenItemsStateFilter {
  if (param === 'all') return 'all';
  return (OPEN_ITEM_FILTER_STATES as readonly string[]).includes(param ?? '') ? (param as OpenItemsStateFilter) : 'open';
}
