import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, messageTexts, staleKeys } from './source';

/**
 * Begriffe (MUSTER § Begriffe, Designer 2026-10-16 Stufe 2 Nr. 10 mit Joes Nachtrag): Was ein Mensch liest, sagt
 * „Agent“ statt „MCP“, „Publizieren“ statt „Publish“/„Veröffentlichen“, „URL-Teil“ statt „Slug“, „Vorgabe“ statt
 * „Default“, „Test“ statt „Staging“, „← Elternseite“ statt „Zurück zu …“, ein Verb statt „OK“. Geprüft wird jeder
 * Text in `messages/de.json`; Schlüssel, Werkzeugnamen und Protokoll-Schlüssel bleiben, wie sie sind. Ausnahmen
 * stehen je Schlüssel mit Grund in der Erlaubnisliste und werden gezählt: Fällt eine weg, wird der Test rot.
 *
 * Dazu der Wortschatz der ganzen Oberfläche („Vorlage“ statt „Template“, „Backup“ statt „Sicherung“) und die
 * Modellwörter der Finanzen (Spec 2026-09-20 § 10.5 „Modell → Oberfläche“): Die Oberfläche spricht in ihrer eigenen
 * Sprache, das Buchungsmodell bleibt unter der Haube. Diese gelten nur in den Texten der Finanzen (`scope`).
 */
interface Rule {
  pattern: RegExp;
  /** Schlüssel → Grund. */
  allowed?: Allowlist;
  /** Nur Schlüssel, für die das gilt; ohne: jeder Text in de.json. */
  scope?: (key: string) => boolean;
}

/**
 * Was die Finanzen ein Mensch lesen lässt: ihre Texte, Navigation, Kacheln, Rechte, die Klartexte, Sätze und Typen des
 * Protokolls (Designer 2026-10-08, Joe 2026-10-09; Spec Protokoll § 6, Befund 42) und ihre Prüfcodes unter
 * `errors.fields` — die übrigen dort gehören anderen Modulen.
 */
const FINANCE_ERROR_FIELDS = new Set(['sphereRequired', 'incomeKindRequired', 'costFunctionRequired', 'costFunctionOnlyForExpense', 'incomeKindOnlyForIncome', 'certifiableOnlyIdeal', 'allowanceOnlyForExpense', 'inputTaxNotInIdeal', 'transitHasNoSphere']);
const under = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}.`);
export const financeSurface = (key: string): boolean =>
  ['finance', 'nav.finance', 'nav.sections.finance', 'dashboard.tiles.finance', 'permissions.keys.finance'].some((prefix) => under(key, prefix)) ||
  /^audit\.(?:actions|sentences)\.finance_/.test(key) ||
  key.startsWith('audit.entities.finance') ||
  (key.startsWith('errors.fields.') && FINANCE_ERROR_FIELDS.has(key.slice('errors.fields.'.length)));

/**
 * Modellwörter der Finanzen. Wortgrenzen sind wichtig: „Sollte“ und das Verb „haben“ (klein) sind erlaubt, „Soll“/„Haben“
 * als Substantiv nicht. Die Oberfläche sagt „Dieselbe Zahlung“/„Eigene Zahlung“ statt Dubletten (Designer 2026-10-09)
 * und „Zahlung im Auszug“ statt „Kandidat“ (Joe 2026-10-09).
 */
const FINANCE_WORDS: Record<string, RegExp> = {
  Soll: /\bSoll\b/,
  Haben: /\bHaben\b/,
  Storno: /\bStorno\w*/,
  stornier: /\bstornier\w*/,
  Periode: /\bPeriode\w*/,
  Geldkonto: /\bGeldkonto\w*/,
  Geldzeile: /\bGeldzeile\w*/,
  Zuordnungszeile: /\bZuordnungszeile\w*/,
  Rohumsatz: /\bRohumsatz\w*/,
  Importlauf: /\bImportlauf\w*/,
  Sphäre: /\bSphäre\w*/,
  Steuerkennzeichen: /\bSteuerkennzeichen\w*/,
  offenerPosten: /[Oo]ffener?\s+Posten/,
  Durchlaufposten: /\bDurchlaufposten\w*/,
  Rücklastschrift: /\bRücklastschrift\w*/,
  Partnerzahlung: /\bPartnerzahlung\w*/,
  Empfängerprofil: /\bEmpfängerprofil\w*/,
  DatierteWerte: /\bDatierte Werte\b/,
  Doppel: /\bDoppel\b/,
  transit: /\btransit\b/,
  Dublette: /\bDublette\w*/,
  Kandidat: /Kandidat\w*/,
};

/**
 * Im CSV-Assistenten benennen „Soll“ und „Haben“ die Spalten der **Bankdatei**, nicht unser Buchungsmodell (Rückmeldung
 * Phase 2, Punkt 3). Sie stehen in Klammern hinter der eigenen Sprache („Ausgang (Soll)“), damit der Nutzer die Spalte
 * seiner Datei wiedererkennt. Nur diese Schlüssel, nur diese zwei Wörter.
 */
const BANK_COLUMN = 'Spalte der Bankdatei im CSV-Assistenten, in Klammern hinter der eigenen Sprache (Rückmeldung Phase 2, Punkt 3).';
const FINANCE_ALLOWED: Record<string, Allowlist> = {
  Soll: {
    'finance.csvAssistant.columns.roles.debit': BANK_COLUMN,
    'finance.csvAssistant.columns.reasons.amountOrDebitCredit': BANK_COLUMN,
  },
  Haben: {
    'finance.csvAssistant.columns.roles.credit': BANK_COLUMN,
    'finance.csvAssistant.columns.reasons.amountOrDebitCredit': BANK_COLUMN,
  },
};

export const RULES: Record<string, Rule> = {
  mcp: {
    pattern: /MCP/,
    allowed: {
      'profile.tokens.intro': 'API-Tokens: „MCP“ nur bei den Tokens und der Einrichtung der Schnittstelle.',
    },
  },
  publish: { pattern: /Publish/ },
  veroeffentlichen: { pattern: /[Vv]eröffentlich/ },
  slug: { pattern: /Slug/ },
  zurueckZu: {
    pattern: /Zurück zu[mr]? /,
    allowed: {
      'dispatchStep.toEmail': 'Zeilenaktion „Zurück zu E-Mail“ im Versand-Schritt (Nachtrag MCP-Test § 2, Designer 2026-10-19), keine Rücknavigation.',
      'dms.errors.mailNotMovedToPost.remedy': 'Nennt die Zeilenaktion „Zurück zu E-Mail“ beim Namen.',
      'dms.errors.mailRecipientPost.remedy': 'Nennt die Zeilenaktion „Zurück zu E-Mail“ beim Namen (Grund manual, Retest N3 V1).',
    },
  },
  ok: { pattern: /^(OK|Ok)$/ },
  default: { pattern: /Default/ },
  staging: { pattern: /Staging/ },
  nurEinMensch: { pattern: /nur ein Mensch/ },
  buchungStorniert: { pattern: /Buchung[^.]*storniert|storniert[^.]*Buchung/ },
  dokumentZurueckgenommen: {
    pattern: /Dokument[^.]*zurückgenommen/,
    allowed: {
      'audit.actions.dms_dispatch_clear': 'Zurückgenommen wird der Versandvermerk, nicht das Dokument.',
      'audit.sentences.dms_dispatch_clear': 'Zurückgenommen wird der Versandvermerk, nicht das Dokument.',
    },
  },
  keins: { pattern: /\bkeins\b/i },
  // „Finanzen einrichten“ ist der Name des Rechts; die Seite heißt „Einrichtung → Finanzen“.
  finanzenEinrichtenAlsOrt: { pattern: /(?:unter|Unter) „?Finanzen einrichten|Finanzen einrichten →|Finanzen einrichten“ →/ },
  // Designer 2026-10-09: „Vorlage“ („Vorlage der Webseite“, wo „Dokumentvorlage“ daneben steht). Großgeschrieben, damit der
  // Dateiname `kompass.template.ts` in einer Meldung nicht trifft.
  template: { pattern: /\bTemplate/ },
  // Joe 2026-10-09: „Backup“ überall, wie Seite und Handbuch. Wortanfang, damit „Sozialversicherung“ nicht trifft.
  sicherung: { pattern: /\bSicherung/ },
  ...Object.fromEntries(
    Object.entries(FINANCE_WORDS).map(([word, pattern]) => [`finanzen:${word}`, { pattern, scope: financeSurface, allowed: FINANCE_ALLOWED[word] }]),
  ),
};

const TEXTS = messageTexts();

const inScope = (rule: Rule) => TEXTS.filter(([key]) => rule.scope?.(key) ?? true);

/** Die Treffer einer Regel in `texts`, die nicht in ihrer Erlaubnisliste stehen. */
export function ruleHits(rule: Rule, texts: [string, string][] = inScope(rule)): string[] {
  return texts.filter(([key, text]) => rule.pattern.test(text) && !(key in (rule.allowed ?? {}))).map(([key, text]) => `${key}: ${text}`);
}

describe('Begriffe in der Sprachdatei', () => {
  it.each(Object.entries(RULES))('%s: kein Treffer außerhalb der Erlaubnisliste', (_name, rule) => {
    expect(ruleHits(rule)).toEqual([]);
  });

  for (const [name, rule] of Object.entries(RULES)) {
    if (rule.allowed) allowlistHygiene(rule.allowed, () => staleKeys(rule.allowed!, inScope(rule).filter(([, text]) => rule.pattern.test(text)).map(([key]) => key)), `${name}: Erlaubnisliste`);
  }
});

describe('Heuristik', () => {
  it('Wortgrenzen: „Sicherung“, nicht „Sozialversicherung“; „Template“, nicht der Dateiname; „Kandidat“ auch zusammengesetzt', () => {
    expect(ruleHits(RULES.sicherung!, [['x', 'Sicherung erstellt'], ['y', 'Lohnsteuer oder Sozialversicherung']])).toEqual(['x: Sicherung erstellt']);
    expect(ruleHits(RULES.template!, [['x', 'Das Template fehlt.'], ['y', 'Es fehlt die Datei kompass.template.ts.']])).toEqual(['x: Das Template fehlt.']);
    expect(ruleHits(RULES['finanzen:Kandidat']!, [['x', 'Für diesen Kontoumsatz-Kandidaten steht es fest.']])).toHaveLength(1);
    expect(ruleHits(RULES['finanzen:Soll']!, [['x', 'Sie sollten prüfen.'], ['y', 'Sollte das so sein?']])).toEqual([]);
  });

  it('die Finanzwörter gelten in Texten, Protokoll und Prüfcodes der Finanzen, nicht in fremden Modulen', () => {
    for (const key of ['finance.x', 'nav.finance', 'audit.actions.finance_openItem_cancel', 'audit.sentences.finance_entry_reverse', 'audit.entities.financeImportRun', 'errors.fields.sphereRequired'])
      expect(financeSurface(key), key).toBe(true);
    for (const key of ['dms.x', 'audit.actions.dms_dispatch_clear', 'errors.fields.required', 'financeX']) expect(financeSurface(key), key).toBe(false);
  });

  it('die Ausnahme der Bankspalten gilt nur für ihr Wort: ein anderes Modellwort am selben Schlüssel bleibt ein Verstoß', () => {
    expect(ruleHits(RULES['finanzen:Storno']!, [['finance.csvAssistant.columns.roles.debit', 'Soll (Storno)']])).toHaveLength(1);
  });
});

/** Datei → Grund: Teile für Betreiber und für Autoren von Vorlagen, dort ist „Template“ der Dateityp. */
const HANDBOOK = path.resolve(import.meta.dirname, '../../../../docs/handbuch');
export const HANDBOOK_ALLOWED: Allowlist = {
  'betrieb.md': 'Betrieb: erklärt das Verzeichnis und die Datei des Templates für die Person, die die Installation betreut.',
  [path.join('webseite', 'template-schreiben.md')]: 'Für Autoren von Vorlagen: erklärt die Template-Datei und ihre Deklaration.',
};

function markdown(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? markdown(full) : name.endsWith('.md') ? [full] : [];
  });
}

describe('Begriffe im Handbuch', () => {
  const hits = markdown(HANDBOOK).flatMap((file) => {
    const rel = path.relative(HANDBOOK, file);
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (/\bTemplate/.test(line.replaceAll('Vorlage (Template-Datei)', '')) ? [{ rel, where: `${rel}:${i + 1}: ${line.trim()}` }] : []));
  });

  it('kein „Template“ in den Handbuchteilen für Nutzer (Designer 2026-10-09)', () => {
    expect(hits.filter(({ rel }) => !(rel in HANDBOOK_ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(HANDBOOK_ALLOWED, () => staleKeys(HANDBOOK_ALLOWED, hits.map(({ rel }) => rel)));
});
