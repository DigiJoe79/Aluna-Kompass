/**
 * Der Zeichensatz der Deutschen Kreditwirtschaft für SEPA-Dateien (DFÜ-Abkommen Anlage 3; Plan L2, Global Constraints):
 * `A–Z a–z 0–9 / - ? : ( ) . , ' +`, Leerzeichen und die Umlaute `Ä Ö Ü ä ö ü ß`. Rein.
 */
const ALLOWED = /^[A-Za-z0-9/\-?:().,'+ ÄÖÜäöüß]$/;
/** Buchstaben, die sich nicht in Grundbuchstabe und Zeichen zerlegen lassen. */
const SPELLED: Record<string, string> = { Ł: 'L', ł: 'l', Ø: 'O', ø: 'o', Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Đ: 'D', đ: 'd', ẞ: 'SS' };

function replaceChar(ch: string): string {
  if (ALLOWED.test(ch)) return ch;
  if (ch === '&') return '+';
  if (SPELLED[ch]) return SPELLED[ch];
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
  return base !== ch && [...base].every((c) => ALLOWED.test(c)) ? base : ' ';
}

/**
 * Text für ein Feld der Bankdatei: erlaubte Zeichen bleiben, `&` wird `+`, Akzente fallen weg (`é` → `e`), alles andere
 * wird ein Leerzeichen; Leerzeichen zusammengezogen, außen gekürzt, höchstens `max` Zeichen.
 */
export function sepaText(input: string, max: number): string {
  const replaced = [...input.normalize('NFC')].map(replaceChar).join('');
  return [...replaced.replace(/ +/g, ' ').trim()].slice(0, max).join('').trim();
}
