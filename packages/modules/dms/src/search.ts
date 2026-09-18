import type { Deps } from '@kompass/core';
import { sql, type SQL } from 'drizzle-orm';
import { documents } from './schema';

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
 * **Satzzeichen bleiben stehen.** Der Trigramm-Tokenizer zerlegt den Text, wie
 * er dasteht: „2026-4711“ liegt mit Bindestrich im Index, und wer ihn abstreift,
 * sucht nach „20264711“ und findet nichts. Gerade Aktenzeichen und Datumsangaben
 * — das, wonach jemand in einer Akte sucht — bestehen zur Hälfte aus
 * Satzzeichen.
 *
 * Entfernt wird allein das Anführungszeichen, und zwar ersatzlos: Es begrenzt
 * die Phrase, die wir bauen. Danach kann keine Eingabe mehr aus ihr ausbrechen,
 * denn innerhalb einer FTS5-Phrase ist jedes andere Zeichen Suchtext und keine
 * Syntax.
 */
export function matchExpression(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length >= MIN_FULLTEXT_CHARS)
    .map((t) => `"${t}"`);

  return terms.length > 0 ? terms.join(' AND ') : null;
}

/**
 * Die Bedingung „dieses Dokument trifft im Volltext“, als Unterabfrage.
 * `null` heißt: Die Eingabe war zu kurz — der Aufrufer sagt das, statt eine
 * leere Liste zu zeigen.
 *
 * Eine Unterabfrage und keine Liste von IDs: Die Treffermenge bliebe sonst
 * vollständig in JavaScript stehen und ginge als ebenso viele Parameter zurück
 * in die Abfrage. SQLite nimmt davon rund 32.000, und was darüber liegt, käme
 * als technischer Fehler heraus statt als Suchergebnis.
 */
export function fulltextCondition(text: string): SQL | null {
  const expression = matchExpression(text);
  if (!expression) return null;

  return sql`${documents.id} IN (SELECT document_id FROM document_text WHERE document_text MATCH ${expression})`;
}

/**
 * Wie groß das Fenster um den Treffer ist. `snippet()` zählt Token, und Token
 * sind hier Trigramme: Mit einem kleinen Wert liefert es einen Wortfetzen statt
 * eines Satzes. 64 ergibt rund eine Zeile Kontext.
 */
export const SNIPPET_TOKENS = 64;

/**
 * Die Markierung ist bewusst kein `<mark>`: Was hier herauskommt, stammt aus
 * einem PDF, das jemand von außen geschickt hat. Steuerzeichen kann die
 * Oberfläche sicher zerlegen; Markup müsste sie erst wieder entschärfen.
 */
export const SNIPPET_MARK_START = '\u0001';
export const SNIPPET_MARK_END = '\u0002';

export interface TextHit {
  documentId: string;
  page: number;
  snippet: string;
}

/**
 * Je Dokument die beste Seite. `bm25()` zählt bei Trigrammen
 * Trigramm-Übereinstimmungen — „die Seite, auf der am meisten passt“. Für die
 * Auswahl einer Passage reicht das; für die Reihenfolge der Liste wird es gar
 * nicht erst herangezogen (Entscheidung 31).
 */
export function fulltextHits(
  deps: Deps,
  documentIds: readonly string[],
  text: string,
): Map<string, TextHit> {
  const expression = matchExpression(text);
  const hits = new Map<string, TextHit>();
  if (!expression || documentIds.length === 0) return hits;

  const placeholders = documentIds.map(() => '?').join(', ');
  const rows = deps.sqlite
    .prepare(
      `SELECT document_id, page,
              snippet(document_text, 2, ?, ?, '…', ?) AS snippet,
              bm25(document_text) AS rank
         FROM document_text
        WHERE document_text MATCH ?
          AND document_id IN (${placeholders})
        ORDER BY rank`,
    )
    .all(SNIPPET_MARK_START, SNIPPET_MARK_END, SNIPPET_TOKENS, expression, ...documentIds) as {
    document_id: string;
    page: number;
    snippet: string;
  }[];

  // `ORDER BY rank` sortiert aufsteigend, und bm25 ist umso kleiner, je besser
  // der Treffer — die erste Zeile je Dokument ist also die beste Seite.
  for (const row of rows) {
    if (!hits.has(row.document_id)) {
      hits.set(row.document_id, { documentId: row.document_id, page: row.page, snippet: row.snippet });
    }
  }
  return hits;
}
