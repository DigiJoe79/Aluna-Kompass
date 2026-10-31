import { conflict } from '@kompass/core';
import { createTranslator } from 'next-intl';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { conflictMessage } from '@/lib/error-text';
import messages from '../messages/de.json';

/**
 * Oberflächentext gehört nach `messages/de.json`, nicht in eine Komponente
 * (AGENTS.md, Prinzip 7).
 *
 * Bis zum 2026-09-15 suchte dieser Wächter nach **deutschen** Wörtern:
 * Umlaute oder eine feste Liste. Das ließ alles durch, was ohne Umlaut
 * auskommt — „Monate“ stand sechsmal in der Aufbewahrung, „Vorschau“ und
 * „Publizieren“ auf zwei Karten, „E-MAIL“ und „STARTPASSWORT“ als
 * Feldbeschriftungen. Eine Wortliste ist prinzipiell unvollständig, und ein
 * grüner Wächter, der die Regel nicht durchsetzt, ist schlimmer als keiner:
 * Man verlässt sich darauf.
 *
 * Gefragt wird deshalb nicht mehr „ist das deutsch?“, sondern „ist das
 * überhaupt ein Literal?“. Alles, was in der Oberfläche sichtbar wird und
 * nicht aus `t(…)` kommt, ist ein Fund — bis auf die Ausnahmen unten, die
 * einzeln begründet sind.
 *
 * Geparst wird mit dem TypeScript-Compiler statt mit einem regulären
 * Ausdruck. Der Vorgänger konnte JSX-Text nicht von einem Typparameter
 * unterscheiden (`useState<Foo>`) und brauchte den Sprachfilter auch deshalb.
 */
const ROOT = path.resolve(import.meta.dirname, '../src');

/**
 * Attribute, deren Wert ein Mensch zu sehen bekommt. `className`, `id`,
 * `type` und Konsorten stehen bewusst nicht hier: Sie tragen Technik, keinen
 * Text.
 */
const SICHTBARE_ATTRIBUTE = new Set(['placeholder', 'title', 'aria-label', 'alt', 'aria-description']);

/**
 * Was als Literal stehen bleiben darf, mit Grund. Wer hier einträgt,
 * entscheidet bewusst.
 *
 * - `px`, `PDF`: Einheit und Dateiformat, in jeder Sprache gleich.
 * - `esc`: die Taste heißt so, auf jeder Tastatur.
 * - `AK`, `LOGO`: Platzhalter für eine fehlende Grafik — Initialen des
 *   Produkts und ein Kürzel, beide sprachneutral, das zweite `aria-hidden`.
 */
const ERLAUBT = new Set(['px', 'PDF', 'esc', 'AK', 'LOGO', 'deg,']);

/**
 * Der Name einer Sprache steht in dieser Sprache — „English“ bleibt
 * „English“, auch in einer deutschen Oberfläche. Solche Endonyme gehören
 * nicht in eine Übersetzungsdatei; sie wären dort in jeder Sprache gleich.
 * Erkannt an der Form „Name (kürzel)“, wie sie die Sprachauswahl verwendet.
 */
const ENDONYM = /^[^()]+ \([a-z]{2}(-[a-z]{2})?\)$/;

/**
 * Ein Satzteil aus einem Template-Literal: Buchstaben, Leerzeichen und
 * Satzzeichen, wie sie in Prosa vorkommen. Alles Technische — `=`, `(`, `"`,
 * `;`, `/`, `<`, `{` — schließt aus, denn dort stehen Query-Parameter,
 * HTTP-Kopfzeilen und CSS-Funktionen.
 */
const PROSA = /^[\p{L}\p{M} ,.!?:–—„“»«×%'’-]+$/u;

/** `t(\`filters.channels.${x}\`)` — ein Präfix, kein Text. */
const istUebersetzungsschluessel = (teil: string) => teil.endsWith('.') && !teil.includes(' ');

/** Steht dieses Literal in `className`? Dann ist es Gestaltung, kein Text. */
function inKlassenAttribut(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText() === 'className';
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) return false;
  }
  return false;
}

/** Mindestens zwei zusammenhängende Buchstaben — sonst ist es ein Zeichen, keine Beschriftung. */
const TRAEGT_TEXT = /\p{L}{2,}/u;

/**
 * Felder, deren Wert auf dem Bildschirm landet — auch in einer `.ts` ohne
 * JSX. Der Umgebungsbalken trug seine Beschriftung („TESTUMGEBUNG“) bis zum
 * 2026-09-15 als Literal in `lib/env-banner.ts`, wo weder der Wächter für
 * Komponenten noch der für Server-Actions je gesucht hätte.
 *
 * `error` steht bewusst nicht dabei: Dort steht üblicherweise ein
 * Übersetzungsschlüssel, kein Satz.
 */
const SICHTBARE_FELDER = new Set(['label', 'title', 'message', 'description', 'summary', 'hint', 'placeholder', 'text']);

/**
 * Objekte, deren Werte alle sichtbar werden, gleich unter welchem Schlüssel: `fieldErrors` einer Server-Action steht
 * unverändert am Feld (`fieldErrors: { name: '…' }`). Was dort steht, kommt aus `t(…)` oder `toActionState`.
 */
const SICHTBARE_BEHAELTER = new Set(['fieldErrors']);

const imSichtbarenBehaelter = (node: ts.PropertyAssignment): boolean =>
  ts.isObjectLiteralExpression(node.parent) && ts.isPropertyAssignment(node.parent.parent) && SICHTBARE_BEHAELTER.has(node.parent.parent.name.getText());

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Ist der Text das einzige Kind seines Elements (Leerraum nicht mitgezählt)? */
function alleinigerInhalt(node: ts.JsxText): boolean {
  const parent = node.parent;
  return ts.isJsxElement(parent) && parent.children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces)).length === 1;
}

/** Trägt das umschließende Element `aria-hidden`? Dann ist der Strich Zierde, kein Wert. */
function verborgen(node: ts.JsxText): boolean {
  const parent = node.parent;
  return ts.isJsxElement(parent) && parent.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === 'aria-hidden');
}

function offendersIn(file: string, source: string): string[] {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const zeile = (node: ts.Node) => src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const besuche = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text && TRAEGT_TEXT.test(text) && !ERLAUBT.has(text)) found.push(`${zeile(node)}: ${text}`);
      // Ein Strich als einziger Inhalt eines Elements ist ein Leerwert — der kommt aus `<Empty />` (Stufe 1, Auftrag 3).
      // Zwischen zwei Werten („von – bis“) oder als verborgener Trenner (`aria-hidden`) ist er Satzzeichen.
      if (/^[—–]$/.test(text) && alleinigerInhalt(node) && !verborgen(node)) found.push(`${zeile(node)}: ${text} (Leerwert: <Empty />)`);
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const wert = node.initializer.text;
      if (SICHTBARE_ATTRIBUTE.has(name) && TRAEGT_TEXT.test(wert) && !ERLAUBT.has(wert)) {
        found.push(`${zeile(node)}: ${name}="${wert}"`);
      }
    }
    // `toast.success('…')` und Geschwister: Die Meldung ist Oberflächentext,
    // auch wenn sie nie in einem JSX-Element steht.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const ziel = node.expression.expression.getText();
      const methode = node.expression.name.getText();
      if (ziel === 'toast' && ['success', 'error', 'info', 'warning', 'message'].includes(methode)) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) && TRAEGT_TEXT.test(arg.text)) found.push(`${zeile(node)}: toast.${methode}("${arg.text}")`);
        }
      }
    }
    /**
     * Ein Template-Literal mit festem Text dazwischen. Sechs deutsche Sätze
     * standen so in `site/template/sync-client.tsx` und beschrieben jeden
     * Befund eines Template-Abgleichs — kein Wächter sah sie, weil beide nur
     * einfache Zeichenketten prüften.
     */
    if (ts.isTemplateExpression(node) && !inKlassenAttribut(node)) {
      for (const roh of [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]) {
        const teil = roh.trim();
        if (teil.length < 3 || istUebersetzungsschluessel(teil) || !PROSA.test(teil) || ERLAUBT.has(teil)) continue;
        const mehrereWoerter = teil.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 2;
        // Ein einzelnes Wort zählt, wenn es an einen Platzhalter grenzt:
        // `${lang} entfernen` ist ein Satz, `${a}${b}` nicht.
        const grenztAnPlatzhalter = /^\s|\s$/.test(roh) && /\p{L}{3,}/u.test(teil);
        if (mehrereWoerter || grenztAnPlatzhalter) {
          found.push(`${zeile(node)}: \`…${teil}…\``);
          break;
        }
      }
    }
    // Ein Objektfeld, dessen Wert sichtbar wird — der Fall ohne JSX.
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      const name = node.name.getText();
      const wert = node.initializer.text;
      if ((SICHTBARE_FELDER.has(name) || imSichtbarenBehaelter(node)) && TRAEGT_TEXT.test(wert) && !ERLAUBT.has(wert) && !ENDONYM.test(wert)) {
        found.push(`${zeile(node)}: ${name}: "${wert}"`);
      }
    }
    ts.forEachChild(node, besuche);
  };
  besuche(src);
  return found;
}

describe('Komponenten schreiben keinen Oberflächentext', () => {
  it('holen jede Beschriftung und jede Meldung aus der Sprachdatei', () => {
    const offenders = walk(ROOT)
      .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
      .flatMap((file) => offendersIn(file, readFileSync(file, 'utf8')).map((t) => `${path.relative(ROOT, file)}:${t}`));

    expect(offenders).toEqual([]);
  });

  /**
   * Beweist, dass der Wächter greift — ohne diesen Fall wäre der Test oben
   * auch dann grün, wenn der Parser nichts fände.
   */
  it('finds a literal in text, in a visible attribute and in a toast', () => {
    const probe = `export const C = () => { toast.success('Gespeichert'); return <p title="Hinweis">Monate</p>; };`;
    const gefunden = offendersIn('probe.tsx', probe);
    // Reihenfolge ist die des Parsers und kein Versprechen.
    expect(gefunden).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Monate'),
        expect.stringContaining('title="Hinweis"'),
        expect.stringContaining('toast.success("Gespeichert")'),
      ]),
    );
    expect(gefunden).toHaveLength(3);
  });

  /** Was eine Server-Action als `message` oder `fieldErrors` zurückgibt, landet unverändert auf dem Bildschirm. */
  it('finds a literal message and fieldErrors in a server action', () => {
    const probe = `export async function save() { return { ok: false, message: 'Fehlt', fieldErrors: { name: 'Pflicht' } }; }`;
    expect(offendersIn('actions.ts', probe)).toEqual([expect.stringContaining('message: "Fehlt"'), expect.stringContaining('name: "Pflicht"')]);
  });
});

/**
 * K2 (Review 0.4.0): Die Haken der Pakete liefern Bezeichnungen, die in Mediathek („verwendet in“), Löschdialogen und
 * Halteliste erscheinen — als `LabelRef` (`{ key, params }`), aufgelöst über `deps.labels`. Der Wächter oben sah nur
 * `apps/kompass/src`; zehn deutsche Literale standen deshalb in `packages/**\/src`. Gesucht wird hier enger als oben,
 * weil die Pakete viel Text tragen, der nie in die Oberfläche geht: Felder `label`, `title`, `reason` mit einem
 * deutschen Literal — ein Umlaut, ein großgeschriebenes Wort mit Leerzeichen danach oder ein einzelnes großgeschriebenes
 * Wort als ganzer Wert, auch als Teil eines Template-Literals.
 */
const PACKAGES = path.resolve(import.meta.dirname, '../../../packages');
const HAKEN_FELDER = new Set(['label', 'title', 'reason']);
const DEUTSCH = /[äöüÄÖÜß]|(^|[\s„(])\p{Lu}\p{Ll}+ |^\p{Lu}\p{Ll}+$/u;

/** Ganze Dateien, deren Text nicht in die Oberfläche geht — je mit Grund. */
const PAKET_AUSNAHMEN = new Map<string, string>([
  ['core/src/testing/index.ts', 'Testhelfer, erfundene Daten'],
  ['modules/finance/src/seed.ts', 'Seed: erfundene Entwicklungsdaten'],
  ['modules/dms/src/seed.ts', 'Seed: erfundene Entwicklungsdaten'],
  ['modules/animals/src/proposals/seed.ts', 'Seed: erfundene Entwicklungsdaten'],
  ['modules/governance/src/seed.ts', 'Seed: erfundene Entwicklungsdaten'],
  ['modules/projects/src/seed.ts', 'Seed: erfundene Entwicklungsdaten'],
  ['modules/finance/src/install.ts', 'Grundausstattung (Dokumentarten) als Nutzdaten aus dem Code (Prinzip 7, zweite Ausnahme)'],
  ['modules/members/src/install.ts', 'Grundausstattung (Dokumentarten) als Nutzdaten aus dem Code (Prinzip 7, zweite Ausnahme)'],
  ['modules/governance/src/install.ts', 'Grundausstattung (Dokumentarten) als Nutzdaten aus dem Code (Prinzip 7, zweite Ausnahme)'],
  ['modules/dms/src/install.ts', 'Grundausstattung (Versandwege) als Nutzdaten aus dem Code (Prinzip 7, zweite Ausnahme)'],
  ['modules/dms/src/catalog.ts', 'Grundausstattung (Dokumentarten) als Nutzdaten aus dem Code (Prinzip 7, zweite Ausnahme)'],
  ['modules/finance/src/reporting/gem-forms.ts', 'Wortlaut des amtlichen Vordrucks Anlage Gem (Prinzip 7, erste Ausnahme)'],
  ['modules/finance/src/reporting/vat-forms.ts', 'Wortlaut des amtlichen Vordrucks zur Umsatzsteuer (Prinzip 7, erste Ausnahme)'],
  ['modules/finance/src/reporting/reports/tax-return-gem-typst.ts', 'Typst-Vorlage der Steuererklärung (PDF-Inhalt)'],
  ['modules/finance/src/reporting/export/tables.ts', 'Inhalt des Datenexports (Dateibeschreibungen im Paket, wie ein PDF)'],
  ['modules/finance/src/auditing/print.ts', 'Typst-Vorlage der Prüfmappe (PDF-Inhalt)'],
  ['modules/finance/src/auditing/package-run.ts', 'Deckblatt der Prüfmappe (PDF-Inhalt)'],
  ['modules/finance/src/closing/handover.ts', 'Typst-Vorlage des Übergabeprotokolls (PDF-Inhalt)'],
  ['modules/finance/src/ledger/cash-count-template.ts', 'Typst-Vorlage der Kassenzählung (PDF-Inhalt)'],
  ['modules/members/src/letters/shared.ts', 'Typst-Vorlage der Mitgliederbriefe (PDF-Inhalt)'],
  ['modules/members/src/letters/count-certificate.ts', 'Typst-Vorlage der Mitgliederbescheinigung (PDF-Inhalt)'],
  ['documents/src/bases.ts', 'Typst-Basis der Dokumente (PDF-Inhalt)'],
  ['modules/finance/src/closing/annual-accounts-view.ts', 'Sicht annualAccounts: Titel der Jahresrechnung wie auf dem PDF (Papiertitel, Plan J2 Task 5), kein Text der Oberfläche'],
]);

/**
 * Eine Löschregel (`deletionRules`, erkannt an `deletable`) begründet für Entwickler und Prüfer, nicht für die
 * Oberfläche — sie ist die maßgebliche Aufstellung nach AGENTS.md Prinzip 3.
 */
const inLoeschregel = (node: ts.PropertyAssignment): boolean =>
  ts.isObjectLiteralExpression(node.parent) && node.parent.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'deletable');

function hakenLiterale(file: string, source: string): string[] {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const besuche = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && HAKEN_FELDER.has(node.name.getText()) && !inLoeschregel(node)) {
      const init = node.initializer;
      const teile = ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? [init.text] : ts.isTemplateExpression(init) ? [init.head.text, ...init.templateSpans.map((s) => s.literal.text)] : [];
      if (teile.some((t) => DEUTSCH.test(t))) found.push(`${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText().slice(0, 80)}`);
    }
    ts.forEachChild(node, besuche);
  };
  besuche(src);
  return found;
}

const paketQuellen = (): string[] =>
  readdirSync(PACKAGES, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /(^|\/)src\//.test(rel) && /\.tsx?$/.test(rel) && !rel.includes('node_modules'))
    .map((rel) => rel.split(path.sep).join('/'));

describe('Pakete liefern Haken-Bezeichnungen über die Sprachdatei', () => {
  it('schreiben kein deutsches Literal in label, title oder reason', () => {
    const offenders = paketQuellen()
      .filter((rel) => !PAKET_AUSNAHMEN.has(rel))
      .flatMap((rel) => hakenLiterale(rel, readFileSync(path.join(PACKAGES, rel), 'utf8')).map((t) => `${rel}:${t}`));
    expect(offenders).toEqual([]);
  });

  it('führt keine Ausnahme für eine Datei, die es nicht mehr braucht', () => {
    const stale = [...PAKET_AUSNAHMEN.keys()].filter((rel) => {
      try {
        return hakenLiterale(rel, readFileSync(path.join(PACKAGES, rel), 'utf8')).length === 0;
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });

  it('findet ein Literal, auch im Template, und lässt Löschregeln und Schlüssel stehen', () => {
    const probe = [
      "const a = { label: 'Logo des Vereins' };",
      'const b = { label: `Tier „${name}“` };',
      "const c = { entity: 'x', deletable: true, reason: 'Arbeitsmaterial der Stammdaten.' };",
      "const d = { label: { key: 'media.usage.logo' } };",
      "const e = { title: 'logo' };",
      "const f = { label: 'Vereinslogo' };",
    ].join('\n');
    expect(hakenLiterale('probe.ts', probe)).toEqual([expect.stringMatching(/^1: label: 'Logo/), expect.stringMatching(/^2: label: `Tier/), expect.stringMatching(/^6: label: 'Vereinslogo/)]);
  });
});

/**
 * Das zweite Argument von `conflict('code', …)` erreicht die Oberfläche (`toActionState`) und MCP, sobald die
 * Sprachdatei für den Code keinen Satz hat oder ihren Satz nur um `{detail}` legt. Dann darf dort kein deutscher Text
 * stehen: Er stünde unübersetzt und ungeprüft auf dem Bildschirm (Backlog 99, „Entferne die Datei“ in Du-Form). Ob er
 * durchkommt, prüft der Wächter an `conflictMessage` selbst, nicht an einer zweiten Liste. Sätze mit Werten gehören in
 * `localizedConflict` mit Schlüssel, ein `{detail}` trägt nur Daten (Namen, Zahlen, Technik).
 */
const SICHTPROBE = 'Sichtprobe des Wächters';
const uebersetzer = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as Parameters<typeof conflictMessage>[1];
const reichtDurch = (code: string): boolean => (conflictMessage(conflict(code, SICHTPROBE).error as Parameters<typeof conflictMessage>[0], uebersetzer) ?? SICHTPROBE).includes(SICHTPROBE);

/** Code → Grund. Deutsche Diensttexte, die durchkommen dürfen. */
const KONFLIKT_AUSNAHMEN = new Map<string, string>([
  ['contactRoleConflict', 'Zwei Module melden dieselbe Kontaktrolle an: Fehler der Module beim Einrichten, trifft niemanden bei der Arbeit.'],
  ['documentBaseUnavailable', 'Die Basis einer Vorlage fehlt in der Installation: Installationsfehler, der Text nennt die Basis.'],
  ['documentImageInvalid', 'Eine Vorlage liefert ein Bild, das kein PNG/JPEG ist: Fehler des Moduls.'],
  ['reviewUiOnly', 'Nur über MCP erreichbar, die Oberfläche bestätigt die Prüfung selbst.'],
  ['documentTypeNotOwned', 'issue() eines Moduls mit einer freien Art: Fehler des aufrufenden Moduls.'],
  ['templateWithoutPermission', 'Eine Modulvorlage ohne Recht: Fehler des Moduls.'],
  ['noLinkedRecord', 'receiveGeneratedUpload ohne angemeldeten Vorgang: Fehler des aufrufenden Moduls.'],
  ['unknownDocumentArea', 'Die Oberfläche bietet nur angemeldete Schutzbereiche an, ein fremder Wert kommt nur über MCP.'],
]);

/** Die `conflict`-Aufrufe mit deutschem Literal als zweitem Argument, deren Text sichtbar würde. */
function sichtbareKonflikte(file: string, source: string): { zeile: number; code: string }[] {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { zeile: number; code: string }[] = [];
  const besuche = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'conflict' && node.arguments.length === 2) {
      const [code, text] = node.arguments as unknown as [ts.Expression, ts.Expression];
      const teile = ts.isStringLiteral(text) || ts.isNoSubstitutionTemplateLiteral(text) ? [text.text] : ts.isTemplateExpression(text) ? [text.head.text, ...text.templateSpans.map((s) => s.literal.text)] : [];
      if (ts.isStringLiteralLike(code) && teile.some((t) => DEUTSCH.test(t)) && reichtDurch(code.text)) found.push({ zeile: src.getLineAndCharacterOfPosition(node.getStart()).line + 1, code: code.text });
    }
    ts.forEachChild(node, besuche);
  };
  besuche(src);
  return found;
}

describe('Konflikte zeigen keinen deutschen Diensttext', () => {
  const treffer = paketQuellen().flatMap((rel) => sichtbareKonflikte(rel, readFileSync(path.join(PACKAGES, rel), 'utf8')).map((k) => ({ rel, ...k })));

  it('kein deutscher Text im zweiten Argument, wo er durchkäme; Ausnahmen mit Grund', () => {
    expect(treffer.filter((k) => !KONFLIKT_AUSNAHMEN.has(k.code)).map((k) => `${k.rel}:${k.zeile}: ${k.code}`)).toEqual([]);
  });

  it('führt keine Ausnahme, die es nicht mehr braucht', () => {
    expect([...KONFLIKT_AUSNAHMEN.keys()].filter((code) => !treffer.some((k) => k.code === code))).toEqual([]);
  });

  it('Gegenprobe: trifft Text ohne Satz und Text in {detail}, nicht den Text hinter einem Satz der Sprachdatei', () => {
    const probe = [
      "const a = conflict('gibtEsNicht', 'Der Vorgang geht nicht');",
      'const b = conflict(\'gibtEsNicht\', `Dokument ${nummer} ist weg`);',
      "const c = conflict('seedAssetsMissing', 'Dateien fehlen');",
      "const d = conflict('documentIsDraft', 'Das ist noch ein Entwurf');",
      "const e = conflict('seedAssetsMissing', missing.join(', '));",
      "const f = localizedConflict('gibtEsNicht', 'errors.x');",
    ].join('\n');
    expect(sichtbareKonflikte('probe.ts', probe)).toEqual([{ zeile: 1, code: 'gibtEsNicht' }, { zeile: 2, code: 'gibtEsNicht' }, { zeile: 3, code: 'seedAssetsMissing' }]);
  });
});
