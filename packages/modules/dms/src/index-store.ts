import type { Deps } from '@kompass/core';

/**
 * Der Volltextindex. Drizzle bildet FTS5 nicht ab — weder die virtuelle Tabelle
 * noch `MATCH`, `snippet()` oder `bm25()`. Gelesen und geschrieben wird deshalb
 * über `deps.sqlite`, aber ausschließlich hier: Der Rest des Moduls sieht
 * Funktionen, kein SQL.
 */

/** Seiten eines Dokuments ersetzen. Zweimal aufgerufen ergibt denselben Bestand. */
export function replaceDocumentText(
  deps: Deps,
  documentId: string,
  pages: readonly { page: number; text: string }[],
): void {
  const remove = deps.sqlite.prepare(`DELETE FROM document_text WHERE document_id = ?`);
  const insert = deps.sqlite.prepare(
    `INSERT INTO document_text (document_id, page, text) VALUES (?, ?, ?)`,
  );

  const write = deps.sqlite.transaction((rows: readonly { page: number; text: string }[]) => {
    remove.run(documentId);
    for (const row of rows) insert.run(documentId, row.page, row.text);
  });

  write(pages);
}

export function removeDocumentText(deps: Deps, documentId: string): void {
  deps.sqlite.prepare(`DELETE FROM document_text WHERE document_id = ?`).run(documentId);
}

export function countDocumentText(deps: Deps, documentId: string): number {
  const row = deps.sqlite
    .prepare(`SELECT count(*) AS n FROM document_text WHERE document_id = ?`)
    .get(documentId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Die Seiten eines Dokuments, wie sie erkannt wurden — für Agenten und Oberfläche. */
export function readDocumentText(deps: Deps, documentId: string): { page: number; text: string }[] {
  return deps.sqlite.prepare(`SELECT page, text FROM document_text WHERE document_id = ? ORDER BY page`).all(documentId) as { page: number; text: string }[];
}
