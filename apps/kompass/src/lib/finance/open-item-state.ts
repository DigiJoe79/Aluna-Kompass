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

/** 'DE•• •••• •••• •••• ••20 51' — Ländercode und die letzten vier Ziffern bleiben sichtbar, in Vierergruppen. */
export function maskIban(iban: string): string {
  const normalized = iban.replace(/\s+/g, '').toUpperCase();
  const len = normalized.length;
  const revealed = normalized
    .split('')
    .map((ch, i) => (i < 2 || i >= len - 4 ? ch : '•'))
    .join('');
  return (revealed.match(/.{1,4}/g) ?? []).join(' ');
}
