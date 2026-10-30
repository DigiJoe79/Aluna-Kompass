import { recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { auditDocumentRef } from './audit-ref';
import { deleteDraftInternal } from './drafts';
import { documentLinks, documents } from './schema';

/**
 * I-C: Ein fremder Datensatz ist gelöscht. Bei Kontakten zählen Bezüge der Akte nicht als Verweis (bei Personen sticht
 * die Löschpflicht), sie kommen also hier an: Die Akte löst jeden Bezug darauf — protokolliert wie `dms.unlink` von
 * Hand. Ein Entwurf, der danach an keinem Datensatz mehr hängt, geht mit (nicht festgeschrieben, Betreff und Text
 * tragen Personenbezug; Joe 2026-10-28); hängt er noch an einem anderen, bleibt er. Eingetragene Dokumente bleiben.
 * Andere Datensätze blockiert `dmsRecordReferences`, solange ein Bezug besteht — dort findet der Haken nichts.
 */
export function dmsRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  const links = tx.select().from(documentLinks).where(and(eq(documentLinks.entityType, entityType), eq(documentLinks.entityId, id))).all();
  const touched = new Set<string>();
  for (const link of links) {
    tx.delete(documentLinks).where(eq(documentLinks.id, link.id)).run();
    const doc = tx.select().from(documents).where(eq(documents.id, link.documentId)).get();
    const ref = doc ? auditDocumentRef(tx, doc) : null;
    recordAudit(tx, deps, ctx, {
      action: 'dms.unlink',
      entityType: 'documentLink',
      entityId: link.id,
      before: { documentId: link.documentId, entityType: link.entityType, ...(ref?.hidden ? {} : { entityId: link.entityId }), role: link.role },
    });
    touched.add(link.documentId);
  }
  for (const documentId of touched) {
    const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc || doc.phase === 'issued') continue;
    const remaining = tx.select({ id: documentLinks.id }).from(documentLinks).where(eq(documentLinks.documentId, documentId)).limit(1).get();
    if (!remaining) deleteDraftInternal(tx, deps, ctx, doc);
  }
}
