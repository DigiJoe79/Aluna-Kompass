/**
 * Prüft ein hochgeladenes SVG auf alles, was darin ausgeführt werden könnte.
 *
 * Ein SVG ist ein Dokument, kein Bild: Eingebunden in die Webseite oder direkt
 * aufgerufen läuft ein Skript darin im Ursprung, der es ausliefert. Die Routen der
 * Anwendung liefern Dateien mit `content-security-policy: sandbox` aus; die
 * veröffentlichte Webseite tut das nicht, und dort schützt nur dieser Filter.
 *
 * Er ist bewusst streng statt vollständig: Er sucht nicht nach jedem denkbaren
 * Angriff, sondern lehnt jede Hülle ab, die fremdes HTML tragen kann
 * (`foreignObject`, `iframe`, `embed`, `object`, `srcdoc`), jedes Ereignis-Attribut
 * und jede Adresse mit einem anderen Schema als `#…`, `data:image/…` (ohne SVG) oder
 * `http(s):`. Vorher dekodiert er Zeichenreferenzen (`&#58;`, `&#x3A;`, `&colon;`)
 * und interne Entities der DTD — sonst ginge `javascript&#58;` als harmloser Text
 * durch. Externe und Parameter-Entities lehnt er ab, statt sie aufzulösen.
 */

const NAMED: Record<string, string> = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", colon: ':', semi: ';', sol: '/', bsol: '\\',
  lpar: '(', rpar: ')', comma: ',', period: '.', excl: '!', num: '#', equals: '=', quest: '?',
  tab: '\t', newline: '\n', nbsp: ' ', grave: '`', lsqb: '[', rsqb: ']', lbrace: '{', rbrace: '}',
};

const ENTITY_DECL = /<!ENTITY\s+([^\s%]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/gi;

function decodeReferences(text: string, entities: Map<string, string>): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9._-]*);?/gi, (match, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return entities.get(ref) ?? NAMED[ref.toLowerCase()] ?? match;
  });
}

/** Volltext mit aufgelösten Referenzen; `null`, wenn die DTD etwas nachlädt oder nicht aufzulösen ist. */
function decoded(svg: string): string | null {
  if (/<!ENTITY\s+%/i.test(svg) || /<!ENTITY\s+\S+\s+(?:SYSTEM|PUBLIC)\b/i.test(svg)) return null;
  const entities = new Map<string, string>();
  for (const m of svg.matchAll(ENTITY_DECL)) entities.set(m[1] as string, m[2] ?? m[3] ?? '');
  let text = svg;
  // Mehrfach: Ein Entity darf auf Referenzen zeigen, eine Referenz auf eine weitere.
  for (let round = 0; round < 8; round++) {
    const next = decodeReferences(text, entities);
    if (next === text) return text;
    text = next;
  }
  return null;
}

const FORBIDDEN_ELEMENT = /<\s*(?:[a-z0-9_.-]+:)?(?:script|foreignobject|iframe|embed|object|handler)\b/i;
const EVENT_HANDLER = /[\s/"']on[a-z]+\s*=/i;
const SCRIPT_SCHEME = /(?:java|vb)script:/i;
const ANIMATED_ADDRESS = /attributename\s*=\s*["']?\s*(?:[a-z0-9_.-]+:)?href\b/i;
const ADDRESS = /[\s/"'](?:[a-z0-9_.-]+:)?(?:href|src|base)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function allowedAddress(raw: string): boolean {
  // Browser werfen Tabs, Zeilenumbrüche und Steuerzeichen aus Adressen — so auch hier.
  const value = raw.replace(/[\u0000-  ]/g, '').toLowerCase();
  if (value === '' || value.startsWith('#')) return true;
  if (value.startsWith('http://') || value.startsWith('https://')) return true;
  if (value.startsWith('data:image/')) return !value.startsWith('data:image/svg');
  // Relativ ohne Schema: kein Doppelpunkt vor dem ersten `/`, `?` oder `#`.
  const scheme = /^[^/?#]*:/.exec(value);
  return scheme === null;
}

/** true, wenn das SVG etwas enthält, das ausgeführt werden könnte (Fehlercode `svgContainsScript`). */
export function svgContainsActiveContent(bytes: Uint8Array): boolean {
  const text = decoded(new TextDecoder().decode(bytes));
  if (text === null) return true;
  const compact = text.replace(/[\t\n\r\u0000]/g, '');
  if (FORBIDDEN_ELEMENT.test(text) || /\bsrcdoc\b/i.test(text) || EVENT_HANDLER.test(text)) return true;
  if (SCRIPT_SCHEME.test(compact) || ANIMATED_ADDRESS.test(text)) return true;
  for (const m of text.matchAll(ADDRESS)) {
    if (!allowedAddress(m[1] ?? m[2] ?? m[3] ?? '')) return true;
  }
  return false;
}
