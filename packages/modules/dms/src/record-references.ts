import type { Deps, RecordReference } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
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
    const doc = deps.db.select({ number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) continue;
    refs.push({ label: doc.number ? `Dokument ${doc.number}` : `Dokument „${doc.subject}“ (Entwurf)`, entity: 'document', id: documentId, href: `/dms/${documentId}` });
  }
  return refs;
}
