/**
 * Betrag schreiben — die eine Stelle für App und PDF-Eingaben (Durchsicht 0.2.11, Stufe 1, Auftrag 1;
 * MUSTER § Beträge, Wächter `no-raw-amount`). Liegt im Finanzmodul, nicht im Kern (Prinzip 1: Euro ist Fachbegriff);
 * browsertauglich über `@kompass/module-finance/format`, ohne `@kompass/core`. Ohne Intl, damit das Ergebnis nicht an der ICU-Fassung hängt:
 * Tausenderpunkt, Dezimalkomma, Minus als U+2212, vor „€“ ein geschütztes Leerzeichen (U+00A0), damit der Betrag
 * nicht umbricht.
 */
const MINUS = '−';
const NBSP = ' ';

export type AmountFormatOptions = {
  /** `always`: auch positive Beträge mit Vorzeichen („+12,00“) — für Bewegungen, die zu- oder abgehen. 0 bleibt ohne. */
  sign?: 'always';
};

/** Ohne €-Zeichen, tausendergruppiert: `1.234,56`; `−60,00`; mit `sign: 'always'` `+12,00`. */
export function formatAmount(cents: number, options: AmountFormatOptions = {}): string {
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const withThousands = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formatted = `${withThousands},${String(rest).padStart(2, '0')}`;
  if (cents < 0) return `${MINUS}${formatted}`;
  return options.sign === 'always' && cents > 0 ? `+${formatted}` : formatted;
}

/** Mit €-Zeichen: `1.234,56 €` bzw. `−60,00 €` (U+00A0 vor „€“). */
export function formatEuro(cents: number, options: AmountFormatOptions = {}): string {
  return `${formatAmount(cents, options)}${NBSP}€`;
}
