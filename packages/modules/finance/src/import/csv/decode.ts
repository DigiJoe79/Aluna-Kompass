/**
 * Kodierungen, die deutsche Banken für CSV nutzen. `windows-1252` und
 * `iso-8859-1` kennt `TextDecoder` in Node (volle ICU) und in jedem Browser.
 */
export type CsvEncoding = 'utf-8' | 'windows-1252' | 'iso-8859-1';

/** Bytes zu Text: UTF-8-BOM weg, jedes Zeilenende wird `\n` (Spec 6.2). */
export function decodeCsv(bytes: Uint8Array, encoding: CsvEncoding): string {
  const body = encoding === 'utf-8' && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  return new TextDecoder(encoding).decode(body).replace(/\r\n?/g, '\n');
}
