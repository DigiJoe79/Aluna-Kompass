/**
 * Anteil schreiben — Promille als Prozent mit einer Nachkommastelle (Jahresrechnung, „Zur Kontrolle“ und Hinweise der
 * Bildschirmansicht). Ohne Intl wie `formatAmount`: Dezimalkomma, Minus als U+2212, vor „%“ dasselbe geschützte
 * Leerzeichen wie vor „€“, damit der Wert nicht umbricht.
 */
const MINUS = '−';
const NBSP = '\u00a0';

/** `184` → `18,4 %`; `-30` → `−3,0 %`. */
export function formatPercent(permille: number): string {
  const abs = Math.abs(Math.round(permille));
  const text = `${Math.floor(abs / 10)},${abs % 10}${NBSP}%`;
  return permille < 0 && abs > 0 ? `${MINUS}${text}` : text;
}
