import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Oberflächentext gehört nach `messages/de.json`, nicht in eine Komponente
 * (AGENTS.md, Prinzip 7). Der Wächter für Server-Actions
 * (`no-hardcoded-action-text.test.ts`) deckte nur das ab, was eine Action
 * zurückgibt — das Sichtbarste, die Beschriftung eines Knopfes, lag ausserhalb
 * seines Blicks.
 *
 * Gesucht wird deutscher Text an den beiden Stellen, an denen er im Code
 * auftaucht: als Inhalt eines JSX-Elements und als Meldung in einem Toast.
 * Kommentare sind vorher entfernt — die sind auf Deutsch und sollen es bleiben.
 */
const ROOT = path.resolve(import.meta.dirname, '../src');

/** Wortmarken, die kein englischer Bezeichner trägt. */
const GERMAN = /[äöüßÄÖÜ]|\b(Abbrechen|Speichern|Zurück|Löschen|Publiziert|Fehler|Anmelden|Verwerfen|Schliessen)\b/;

/** JSX-Textinhalt zwischen zwei Marken, ohne geschweifte Ausdrücke. */
const JSX_TEXT = />(\s*[^<>{}\n][^<>{}]*?)</g;
/** Eine Meldung, die als Zeichenkette in einem Toast steht. */
const TOAST_LITERAL = /toast\.(?:success|error|info|warning)\([^)]*?['"`]([^'"`]{3,})['"`]/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Ohne Kommentare — die sind auf Deutsch und gehören nicht geprüft. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function offendersIn(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  for (const [, text] of code.matchAll(JSX_TEXT)) {
    const trimmed = (text ?? '').trim();
    if (trimmed && GERMAN.test(trimmed)) found.push(trimmed);
  }
  for (const [, text] of code.matchAll(TOAST_LITERAL)) {
    if (text && GERMAN.test(text)) found.push(text);
  }
  return found;
}

describe('Komponenten schreiben keinen Oberflächentext', () => {
  it('holen jede Beschriftung und jede Meldung aus der Sprachdatei', () => {
    const offenders = walk(ROOT)
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) =>
        offendersIn(readFileSync(file, 'utf8')).map(
          (text) => `${path.relative(ROOT, file)}: ${text}`,
        ),
      );

    expect(offenders).toEqual([]);
  });
});
