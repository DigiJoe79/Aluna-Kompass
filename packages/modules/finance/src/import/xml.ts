import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Sicherheit für fremdes XML (Kontoauszüge, Rechnungen), an einer Stelle.
 * Rein: importiert nur `fast-xml-parser` — der ZUGFeRD-Parser darf es deshalb
 * nutzen, ohne seine Reinheit zu verlieren (`zugferd-purity.test.ts`).
 *
 * Reihenfolge, auf dem dekodierten Text und vor jedem Parserlauf:
 * Größenlimit, `<!DOCTYPE`/`<!ENTITY` verboten, Validator. Der Parser läuft
 * zusätzlich mit `processEntities: false` — die Ablehnung wäre also auch ohne
 * die Vorprüfung wirksam.
 */

export type XmlGuardResult = { ok: true; text: string } | { ok: false; code: 'tooLarge' | 'notXml' | 'doctypeRefused' };

/** Erkennt die Kodierung über eine Byte-Order-Mark; ohne BOM wird UTF-8 angenommen. */
export function decodeXmlText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

export function guardXml(bytes: Uint8Array, opts: { maxBytes: number }): XmlGuardResult {
  if (bytes.byteLength > opts.maxBytes) return { ok: false, code: 'tooLarge' };

  const text = decodeXmlText(bytes);
  if (!text.trimStart().startsWith('<')) return { ok: false, code: 'notXml' };
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) return { ok: false, code: 'doctypeRefused' };
  if (XMLValidator.validate(text) !== true) return { ok: false, code: 'notXml' };

  return { ok: true, text };
}

/**
 * Der Parser mit den festen Einstellungen: keine Entitäten, Namensraum-Präfixe
 * weg, Werte bleiben Zeichenketten (Beträge rechnet der Aufrufer selbst in
 * Cent), Attribute unter `@_`, Text unter `#text`. `arrays` nennt die Tags,
 * die immer als Liste kommen sollen.
 */
export function secureXmlParser(opts: { arrays?: readonly string[] } = {}): XMLParser {
  const arrays = new Set(opts.arrays ?? []);
  return new XMLParser({
    processEntities: false,
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    removeNSPrefix: true,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    isArray: (name) => arrays.has(name),
  });
}

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Löst die fünf vordefinierten Entitäten und Zeichenreferenzen eines
 * Textwerts auf — genau einmal, in einem Durchgang. Der Parser läuft ohne
 * Entitäten (`processEntities: false`), damit keine DTD je wirkt; für Namen
 * und Nummern, die ein Mensch liest, braucht es aber `&` statt `&amp;`.
 * Alles andere bleibt stehen, wie es ist.
 */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, name: string) => {
    if (!name.startsWith('#')) return PREDEFINED[name]!;
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : whole;
  });
}
