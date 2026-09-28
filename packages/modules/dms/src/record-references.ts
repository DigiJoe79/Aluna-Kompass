import type { Deps, RecordReference } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { isProtectedType } from './access';
import { documentTypeFor } from './catalog';
import { documentLinks, documents } from './schema';

/**
 * Jedes Dokument, das auf den Datensatz zeigt — Entwurf wie festgeschrieben,
 * Frist laufend wie abgelaufen. `dmsRetentionHolds` beantwortet die Frage nach
 * der Rechenschaft; diese hier die nach der Integrität: Ein Bezug auf einen
 * gelöschten Datensatz wäre ein toter Link in der Akte. Wer löschen will, löst
 * erst den Bezug (`dms.unlink`, protokolliert).
 */
export function dmsRecordReferences(deps: Deps, entityType: string, id: string): RecordReference[] {
  const documentIds = new Set(
    deps.db
      .select({ documentId: documentLinks.documentId })
      .from(documentLinks)
      .where(and(eq(documentLinks.entityType, entityType), eq(documentLinks.entityId, id)))
      .all()
      .map((l) => l.documentId),
  );
  const refs: RecordReference[] = [];
  for (const documentId of documentIds) {
    const doc = deps.db.select({ number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) continue;
    const hidden = isProtectedType(documentTypeFor(deps.db, doc.typeKey));
    // Der Haken weiß nicht, wer fragt — bei einer geschützten Art nennt er nie den Betreff.
    const label = doc.number ? `Dokument ${doc.number}` : hidden ? 'Entwurf (geschützt)' : `Dokument „${doc.subject}“ (Entwurf)`;
    refs.push({ label, entity: 'document', id: documentId, href: `/dms/${documentId}` });
  }
  return refs;
}
