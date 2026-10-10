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
  // Die Oberfläche spricht von „Dieselbe Zahlung“ / „Eigene Zahlung“ (finance.import.candidates), nie von Dubletten (Designer 2026-10-09).
  { pattern: /\bDublette\w*/, word: 'Dublette' },
  // Joe 2026-10-09: Die Oberfläche sagt „Zahlung im Auszug“ wie das Protokoll, nie „Kandidat“.
  { pattern: /Kandidat\w*/, word: 'Kandidat' },
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

  // Die Klartexte der Protokoll-Aktionen der Finanzen liest ein Mensch im Filter „Aktion“ (und künftig in Tabelle und
  // PDF, Backlog 33) — „Offene Zahlung storniert“ rutschte durch, weil nur `finance.*` geprüft wurde (Designer 2026-10-08).
  const actions = (at(messages, ['audit', 'actions']) ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(actions)) {
    if (key.startsWith('finance_')) strings.set(`audit.actions.${key}`, value);
  }
  // Auch die Sätze des Protokolls (Spec Protokoll § 6, Wächter 4; Befund 42): Sie stehen jetzt in de.json, nicht im Code.
  const sentences = (at(messages, ['audit', 'sentences']) ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(sentences)) {
    if (key.startsWith('finance_')) strings.set(`audit.sentences.${key}`, value);
  }

  // Und die Typen in der Spalte „Objekt“ (Joe 2026-10-09): „Importlauf“ statt „Auszug“ fiele sonst durch.
  const entities = (at(messages, ['audit', 'entities']) ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(entities)) {
    if (key.startsWith('finance')) strings.set(`audit.entities.${key}`, value);
  }

  const fields = (at(messages, ['errors', 'fields']) ?? {}) as Record<string, string>;
  for (const key of FINANCE_ERROR_FIELDS) {
    if (key in fields) strings.set(`errors.fields.${key}`, fields[key]!);
  }
  return strings;
}

/**
 * Einzige Ausnahme: Im CSV-Assistenten benennen „Soll“ und „Haben“ die Spalten
 * der **Bankdatei**, nicht unser Buchungsmodell (Rückmeldung Phase 2, Punkt 3).
 * Sie stehen dort in Klammern hinter der eigenen Sprache („Ausgang (Soll)“),
 * damit der Nutzer die Spalte seiner Datei wiedererkennt. Nur diese Schlüssel,
 * nur diese zwei Wörter.
 */
const BANK_COLUMN_EXCEPTIONS: { keys: string[]; words: string[] } = {
  keys: ['finance.csvAssistant.columns.roles.debit', 'finance.csvAssistant.columns.roles.credit', 'finance.csvAssistant.columns.reasons.amountOrDebitCredit'],
  words: ['Soll', 'Haben'],
};

function findHits(strings: Map<string, string>): string[] {
  const hits: string[] = [];
  for (const [key, value] of strings) {
    for (const { pattern, word } of FORBIDDEN) {
      if (BANK_COLUMN_EXCEPTIONS.keys.includes(key) && BANK_COLUMN_EXCEPTIONS.words.includes(word)) continue;
      if (pattern.test(value)) hits.push(`${key}: Modellwort „${word}“ in "${value}"`);
    }
  }
  return hits;
}

describe('Verbotsliste der Modellwörter (Finanzen)', () => {
  it('prüft auch die Klartexte der Protokoll-Aktionen der Finanzen', () => {
    const strings = collectFinanceSurfaceStrings();
    expect(strings.has('audit.actions.finance_openItem_cancel')).toBe(true);
    expect(findHits(new Map([['audit.actions.finance_openItem_cancel', 'Offene Zahlung storniert']]))).not.toEqual([]);
  });

  it('prüft auch die Sätze der Protokoll-Aktionen der Finanzen', () => {
    const strings = collectFinanceSurfaceStrings();
    expect(strings.has('audit.sentences.finance_entry_reverse')).toBe(true);
    expect(findHits(new Map([['audit.sentences.finance_account_setActive', 'Geldkonto stillgelegt']]))).not.toEqual([]);
  });

  it('sperrt „Kandidat“, auch in Zusammensetzungen', () => {
    expect(findHits(new Map([['x', 'Für diesen Kontoumsatz-Kandidaten steht die Entscheidung schon fest.']]))).not.toEqual([]);
  });

  it('prüft auch die Typen der Finanzen in der Spalte „Objekt“', () => {
    const strings = collectFinanceSurfaceStrings();
    expect(strings.has('audit.entities.financeImportRun')).toBe(true);
    expect(findHits(new Map([['audit.entities.financeImportRun', 'Importlauf']]))).not.toEqual([]);
  });

  it('kein Modellwort erscheint in den geprüften Namensräumen von de.json', () => {
    const hits = findHits(collectFinanceSurfaceStrings());
    expect(hits).toEqual([]);
  });

  it('nennt die Spalten der Bankdatei mit ihrem Wort, aber nur im CSV-Assistenten', () => {
    const strings = collectFinanceSurfaceStrings();
    expect(strings.get('finance.csvAssistant.columns.roles.debit')).toBe('Ausgang (Soll)');
    expect(strings.get('finance.csvAssistant.columns.roles.credit')).toBe('Eingang (Haben)');
    // Dieselben Wörter anderswo bleiben ein Verstoß — und auch ein anderes Modellwort an der Ausnahme.
    strings.set('finance.__test.elsewhere', 'Soll und Haben');
    strings.set('finance.csvAssistant.columns.roles.debit', 'Soll (Storno)');
    expect(findHits(strings)).toEqual([
      'finance.csvAssistant.columns.roles.debit: Modellwort „Storno“ in "Soll (Storno)"',
      'finance.__test.elsewhere: Modellwort „Soll“ in "Soll und Haben"',
      'finance.__test.elsewhere: Modellwort „Haben“ in "Soll und Haben"',
    ]);
  });

  it('findet einen bekannten Verstoß, wenn einer eingeschmuggelt wird', () => {
    const strings = collectFinanceSurfaceStrings();
    strings.set('finance.__test.smuggled', 'Dies ist ein Storno.');
    expect(findHits(strings)).toEqual(['finance.__test.smuggled: Modellwort „Storno“ in "Dies ist ein Storno."']);
  });
});
