import { isoNow, newId, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { documentLinks } from './schema';

/**
 * Ein Bezug auf den Vorgang eines Moduls — der Beweis, auf den
 * `readLinkedDocument` sich stützt. Ein Modul, das seine Verknüpfungen in einer
 * eigenen Tabelle führt, schreibt **beide** in derselben Transaktion. Idempotent.
 */
export function linkDocumentInternal(tx: DbOrTx, deps: Deps, input: { documentId: string; entityType: string; entityId: string; role?: 'sender' | 'recipient' | 'about' }): string {
  const role = input.role ?? 'about';
  const existing = tx
    .select({ id: documentLinks.id })
    .from(documentLinks)
    .where(and(eq(documentLinks.documentId, input.documentId), eq(documentLinks.entityType, input.entityType), eq(documentLinks.entityId, input.entityId), eq(documentLinks.role, role)))
    .get();
  if (existing) return existing.id;
  const id = newId();
  tx.insert(documentLinks).values({ id, documentId: input.documentId, entityType: input.entityType, entityId: input.entityId, role, createdAt: isoNow(deps.clock) }).run();
  return id;
}

/** Löst alle Bezüge des Dokuments auf diesen Vorgang. Protokolliert wird im Dienst des Moduls. */
export function unlinkDocumentInternal(tx: DbOrTx, input: { documentId: string; entityType: string; entityId: string }): number {
  return tx
    .delete(documentLinks)
    .where(and(eq(documentLinks.documentId, input.documentId), eq(documentLinks.entityType, input.entityType), eq(documentLinks.entityId, input.entityId)))
    .run().changes;
}
