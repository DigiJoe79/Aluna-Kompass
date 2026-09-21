import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Verbotsliste der Modellwörter (Spec 2026-09-20 § 10.5 „Modell → Oberfläche“).
 * Die Oberfläche spricht in ihrer eigenen Sprache — das Buchungsmodell bleibt
 * unter der Haube. Wortgrenzen sind wichtig: „Sollte“ und das Verb „haben“
 * (klein geschrieben) sind erlaubt, „Soll“/„Haben“ als Substantiv nicht.
 */
const FORBIDDEN: { pattern: RegExp; word: string }[] = [
  { pattern: /\bSoll\b/, word: 'Soll' },
  { pattern: /\bHaben\b/, word: 'Haben' },
  { pattern: /\bStorno\w*/, word: 'Storno' },
  { pattern: /\bstornier\w*/, word: 'stornier' },
  { pattern: /\bPeriode\w*/, word: 'Periode' },
  { pattern: /\bGeldkonto\w*/, word: 'Geldkonto' },
  { pattern: /\bGeldzeile\w*/, word: 'Geldzeile' },
  { pattern: /\bZuordnungszeile\w*/, word: 'Zuordnungszeile' },
  { pattern: /\bRohumsatz\w*/, word: 'Rohumsatz' },
  { pattern: /\bImportlauf\w*/, word: 'Importlauf' },
  { pattern: /\bSphäre\w*/, word: 'Sphäre' },
  { pattern: /\bSteuerkennzeichen\w*/, word: 'Steuerkennzeichen' },
  { pattern: /[Oo]ffener?\s+Posten/, word: 'offener/offene Posten' },
  { pattern: /\bDurchlaufposten\w*/, word: 'Durchlaufposten' },
  { pattern: /\bRücklastschrift\w*/, word: 'Rücklastschrift' },
  { pattern: /\bPartnerzahlung\w*/, word: 'Partnerzahlung' },
  { pattern: /\bEmpfängerprofil\w*/, word: 'Empfängerprofil' },
  { pattern: /\bDatierte Werte\b/, word: 'Datierte Werte' },
  { pattern: /\bDoppel\b/, word: 'Doppel' },
  { pattern: /\btransit\b/, word: 'transit' },
];

/**
 * Die finanzbezogenen Einträge unter `errors.fields.*` — die anderen dort
 * gehören anderen Modulen (Kern, DMS, Kontakte …) und sind hier nicht
 * geprüft.
 */
const FINANCE_ERROR_FIELDS = [
  'sphereRequired',
  'incomeKindRequired',
  'costFunctionRequired',
  'costFunctionOnlyForExpense',
  'incomeKindOnlyForIncome',
  'certifiableOnlyIdeal',
  'allowanceOnlyForExpense',
  'inputTaxNotInIdeal',
  'transitHasNoSphere',
];

function collectStrings(node: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectStrings(value, `${prefix}[${index}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectStrings(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
}

function at(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), root);
}

function collectFinanceSurfaceStrings(): Map<string, string> {
  const strings = new Map<string, string>();
  collectStrings(at(messages, ['finance']), 'finance', strings);
  collectStrings(at(messages, ['nav', 'finance']), 'nav.finance', strings);
  collectStrings(at(messages, ['nav', 'sections', 'finance']), 'nav.sections.finance', strings);
  collectStrings(at(messages, ['dashboard', 'tiles', 'finance']), 'dashboard.tiles.finance', strings);
  // Auch die Beschreibungen der Finanzrechte liest ein Mensch — in der Rollenverwaltung.
  collectStrings(at(messages, ['permissions', 'keys', 'finance']), 'permissions.keys.finance', strings);

  const fields = (at(messages, ['errors', 'fields']) ?? {}) as Record<string, string>;
  for (const key of FINANCE_ERROR_FIELDS) {
    if (key in fields) strings.set(`errors.fields.${key}`, fields[key]!);
  }
  return strings;
}

function findHits(strings: Map<string, string>): string[] {
  const hits: string[] = [];
  for (const [key, value] of strings) {
    for (const { pattern, word } of FORBIDDEN) {
      if (pattern.test(value)) hits.push(`${key}: Modellwort „${word}“ in "${value}"`);
    }
  }
  return hits;
}

describe('Verbotsliste der Modellwörter (Finanzen)', () => {
  it('kein Modellwort erscheint in den geprüften Namensräumen von de.json', () => {
    const hits = findHits(collectFinanceSurfaceStrings());
    expect(hits).toEqual([]);
  });

  it('findet einen bekannten Verstoß, wenn einer eingeschmuggelt wird', () => {
    const strings = collectFinanceSurfaceStrings();
    strings.set('finance.__test.smuggled', 'Dies ist ein Storno.');
    expect(findHits(strings)).toEqual(['finance.__test.smuggled: Modellwort „Storno“ in "Dies ist ein Storno."']);
  });
});
