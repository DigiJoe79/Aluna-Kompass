import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function offendersIn(file: string, source: string): string[] {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const zeile = (node: ts.Node) => src.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const besuche = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text && TRAEGT_TEXT.test(text) && !ERLAUBT.has(text)) found.push(`${zeile(node)}: ${text}`);
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
      if (SICHTBARE_FELDER.has(name) && TRAEGT_TEXT.test(wert) && !ERLAUBT.has(wert) && !ENDONYM.test(wert)) {
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
});
