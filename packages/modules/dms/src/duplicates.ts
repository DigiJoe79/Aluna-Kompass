import type { CallContext, DbOrTx, Deps } from '@kompass/core';
import { and, asc, eq, ne } from 'drizzle-orm';
import { readableTypeFilter } from './access';
import { documents } from './schema';

/** Ein abgelegtes Dokument mit derselben Datei — Nummer und Weg dorthin. */
export interface DuplicateRef {
  id: string;
  number: string | null;
}

/**
 * Befund Z (Prüfer Block 3): Abgelegte, nicht stornierte Dokumente mit
 * derselben Prüfsumme, die der Aufrufer lesen darf — ohne das Dokument selbst.
 * Die Akte legt trotzdem ab (zwei Schreiben an zwei Empfänger sind zwei
 * Vorgänge, `storage.ts`); sie sagt nur, dass die Datei schon da ist.
 * Berechnet, nie gespeichert (Prinzip 5). Unlesbare Arten bleiben weg, sonst
 * verriete der Hinweis Nummern aus einem geschützten Bereich.
 */
export function duplicatesOfInternal(deps: Deps, ctx: CallContext, db: DbOrTx, checksum: string | null, excludeId: string): DuplicateRef[] {
  if (!checksum) return [];
  return db
    .select({ id: documents.id, number: documents.number })
    .from(documents)
    .where(and(eq(documents.fileChecksum, checksum), eq(documents.phase, 'issued'), ne(documents.status, 'voided'), ne(documents.id, excludeId), readableTypeFilter(deps, ctx, db)))
    .orderBy(asc(documents.createdAt), asc(documents.id))
    .all();
}
