/**
 * Hinweise aus den Bankdaten (F5, Annahme 13). Rein — Wächter
 * `suggest-purity.test.ts`.
 */

/**
 * Eine IBAN außerhalb Deutschlands deutet auf eine Partnerzahlung hin — nur
 * ein gedämpfter Hinweis, kein Vorschlag und kein Datensatz (kommt mit F7).
 */
export function paymentServiceHint(counterpartyIban: string | null): 'foreignIban' | null {
  const iban = (counterpartyIban ?? '').replace(/\s+/g, '').toUpperCase();
  if (iban.length === 0) return null;
  return iban.startsWith('DE') ? null : 'foreignIban';
}
