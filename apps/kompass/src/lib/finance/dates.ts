/**
 * Rohe ISO-Daten an der Finanz-Oberfläche (Design-Nachtrag N3, W-0/N-1):
 * Werte wie `bookingDate`, `dueOn` oder `statementDate` sind oft `string |
 * null` — ein Umsatz ohne Wertstellung, ein Lauf ohne Zeitraum. `date()` aus
 * `useDateFormat()` (oder der serverseitige `formatDate`) formatiert nur den
 * Wert, den er bekommt; dieser Helfer entscheidet vorher: kein Wert → „—“,
 * sonst der vorhandene Formatierer.
 */
export function formatDateOrDash(fmt: (value: string | null | undefined) => string, iso: string | null | undefined): string {
  return iso ? fmt(iso) : '—';
}
