/**
 * Seitenzahl eines PDF, im Browser aus den Bytes gelesen (Board-Fund F8a,
 * Design-Nachtrag Phase 4: „1 Seite · 184 KB“ in der Dateizeile eines
 * Belegs). Gezählt werden Seitenobjekte `/Type /Page`, nie der Seitenbaum
 * `/Pages`. Liegen die Objekte komprimiert in Objektströmen, findet sich
 * keines — dann `null`, und die Zeile nennt keine Zahl statt einer falschen.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  if (!(bytes.length >= 5 && [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => bytes[i] === b))) return null;
  // latin1: jedes Byte ein Zeichen, auch in Binärteilen.
  const text = new TextDecoder('latin1').decode(bytes);
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}
