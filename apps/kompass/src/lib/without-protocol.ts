/**
 * Eine Webadresse zum Lesen: ohne `http://` bzw. `https://` und ohne Schrägstrich am Ende (Runde 3, 038). Nur für die
 * Anzeige; gespeichert und verlinkt wird der volle Wert. Anderes (E-Mail, Telefon) bleibt, wie es ist.
 */
export function withoutProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value.replace(/^https?:\/\//i, '').replace(/\/$/, '') : value;
}
