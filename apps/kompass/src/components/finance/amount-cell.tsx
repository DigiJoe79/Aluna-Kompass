import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';

/**
 * Betragsanzeige in Tabellen (HANDOFF § 2.2). Rechtsbündig, Textschrift mit `tabular-nums` (Auftrag 5: Mono nur für Kennungen),
 * deutsches Format. Ausgaben tragen das echte Minuszeichen und `text-amount-out`;
 * Einnahmen weder Zeichen noch Farbe. Zurückgenommenes ist durchgestrichen und
 * gedämpft — Zustand und Betrag gemeinsam.
 */
export function AmountCell({ cents, reversed }: { cents: number; reversed?: boolean }) {
  return (
    <span
      className={cn(
        'block text-right text-meta tabular-nums',
        reversed ? 'text-muted-ink line-through' : cents < 0 ? 'text-amount-out' : 'text-ink',
      )}
    >
      {formatEuro(cents)}
    </span>
  );
}
