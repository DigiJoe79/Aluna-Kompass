/**
 * Trifft eine Regel einen Kontoumsatz? Rein, ohne Datenbank und ganz ohne
 * Import (F5; Wächter `suggest-purity.test.ts`), damit dieselbe Prüfung im
 * Dienst, in der Vorschau und später im Browser läuft. Neutraler Boden seit
 * F8a: Auch `allocation/` (Kategorievorschlag der Freigabe) braucht sie und
 * darf `import/` nicht kennen (`direction.test.ts`); `import/suggest/rule.ts`
 * reicht sie weiter.
 */

export interface RuleConditions {
  accountId: string | null;
  direction: 'in' | 'out' | null;
  counterpartyIban: string | null;
  textContains: string | null;
  amountMinCents: number | null;
  amountMaxCents: number | null;
}

export interface RuleTarget {
  bookingDate: string;
  accountId: string;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string;
}

/**
 * Wie `normalizePurpose` (Dublettenschlüssel): Kleinbuchstaben, Umlaute und ß
 * gefaltet, jeder Leerraum entfernt — aber ohne Kürzung auf 40 Zeichen, weil
 * ein Textteil auch hinten im Verwendungszweck stehen darf.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '');
}

const compactIban = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();

/** Alle gesetzten Bedingungen müssen treffen; ohne jede Bedingung trifft eine Regel nichts. */
export function ruleMatches(c: RuleConditions, t: RuleTarget): boolean {
  const set = c.accountId !== null || c.direction !== null || c.counterpartyIban !== null || c.textContains !== null || c.amountMinCents !== null || c.amountMaxCents !== null;
  if (!set) return false;
  if (c.accountId !== null && c.accountId !== t.accountId) return false;
  if (c.direction === 'in' && !(t.amountCents > 0)) return false;
  if (c.direction === 'out' && !(t.amountCents < 0)) return false;
  if (c.counterpartyIban !== null && (t.counterpartyIban === null || compactIban(t.counterpartyIban) !== compactIban(c.counterpartyIban))) return false;
  if (c.textContains !== null && !normalizeText(`${t.counterpartyName ?? ''} ${t.purpose}`).includes(normalizeText(c.textContains))) return false;
  const amount = Math.abs(t.amountCents);
  if (c.amountMinCents !== null && amount < c.amountMinCents) return false;
  if (c.amountMaxCents !== null && amount > c.amountMaxCents) return false;
  return true;
}
