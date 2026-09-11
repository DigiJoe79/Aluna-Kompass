import type { Deps } from '@kompass/core';

/**
 * Kürzer als drei Zeichen findet der Trigramm-Tokenizer nichts — er zerlegt in
 * Dreiergruppen, und für „ab“ gibt es keine. Das ist keine Panne, sondern der
 * Preis dafür, dass „rechnung“ die „Tierarztrechnung“ findet.
 */
export const MIN_FULLTEXT_CHARS = 3;

/**
 * Aus einer Eingabe wird ein FTS5-Ausdruck: jedes Wort eine Phrase, verbunden
 * mit UND. Phrasen, weil Trigramme sonst als Syntax gelesen würden.
 *
 * Anführungszeichen in der Eingabe werden verdoppelt — das ist FTS5' eigene
 * Entschärfung. Ohne sie könnte eine Eingabe den Ausdruck umschreiben.
 */
export function matchExpression(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}"]/gu, ''))
    .filter((t) => t.replace(/"/g, '').length >= MIN_FULLTEXT_CHARS)
    .map((t) => `"${t.replace(/"/g, '""')}"`);

  return terms.length > 0 ? terms.join(' AND ') : null;
}

/**
 * Die Dokumente, in deren Volltext der Ausdruck trifft. `null` heißt: Die
 * Eingabe war zu kurz — der Aufrufer sagt das, statt eine leere Liste zu zeigen.
 */
export function fulltextDocumentIds(deps: Deps, text: string): string[] | null {
  const expression = matchExpression(text);
  if (!expression) return null;

  const rows = deps.sqlite
    .prepare(`SELECT DISTINCT document_id FROM document_text WHERE document_text MATCH ?`)
    .all(expression) as { document_id: string }[];

  return rows.map((r) => r.document_id);
}
