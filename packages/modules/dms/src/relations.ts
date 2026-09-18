import {
  conflict,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { RELATION_KINDS, documentRelations, documents, type DocumentRelationRow, type RelationKind } from './schema';

export interface DocumentRelationView {
  id: string;
  kind: RelationKind;
  /** `out`: dieses Dokument ist `documentId` („ist Antwort auf“); `in`: es ist das andere Ende („beantwortet durch“). */
  direction: 'out' | 'in';
  otherId: string;
  otherNumber: string | null;
  otherSubject: string;
  otherPhase: 'draft' | 'issued';
}

export const relateSchema = z.object({
  documentId: z.string().min(1),
  relatedDocumentId: z.string().min(1),
  kind: z.enum(RELATION_KINDS),
});

export const unrelateSchema = z.object({ id: z.string().min(1) });

/** Beide Richtungen, jede Zeile mit Nummer, Betreff und Phase des anderen Endes. */
export function relationsFor(db: DbOrTx, documentId: string): DocumentRelationView[] {
  const other = (id: string) => db.select({ number: documents.number, subject: documents.subject, phase: documents.phase }).from(documents).where(eq(documents.id, id)).get();
  const view = (row: DocumentRelationRow, direction: 'out' | 'in'): DocumentRelationView | null => {
    const otherId = direction === 'out' ? row.relatedDocumentId : row.documentId;
    const doc = other(otherId);
    if (!doc) return null;
    return { id: row.id, kind: row.kind, direction, otherId, otherNumber: doc.number, otherSubject: doc.subject, otherPhase: doc.phase };
  };
  const out = db.select().from(documentRelations).where(eq(documentRelations.documentId, documentId)).all().map((r) => view(r, 'out'));
  const inbound = db.select().from(documentRelations).where(eq(documentRelations.relatedDocumentId, documentId)).all().map((r) => view(r, 'in'));
  return [...out, ...inbound].filter((v): v is DocumentRelationView => v !== null);
}

export async function relateDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRelationRow>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, relateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.documentId === v.relatedDocumentId) return conflict('relationSelf', 'Ein Dokument kann sich nicht auf sich selbst beziehen');

  const [doc, related] = [v.documentId, v.relatedDocumentId].map((id) =>
    deps.db.select({ id: documents.id, number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, id)).get(),
  );
  if (!doc) return notFound('document', v.documentId);
  if (!related) return notFound('document', v.relatedDocumentId);

  const id = newId();
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      tx.insert(documentRelations).values({ id, documentId: v.documentId, relatedDocumentId: v.relatedDocumentId, kind: v.kind, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock) }).run();
      recordAudit(tx, deps, ctx, {
        action: 'dms.relate',
        entityType: 'documentRelation',
        entityId: id,
        after: { documentId: v.documentId, relatedDocumentId: v.relatedDocumentId, kind: v.kind },
        summary: `Bezug „${v.kind}“ von ${doc.number ?? doc.subject} auf ${related.number ?? related.subject} angelegt`,
      });
      return ok(tx.select().from(documentRelations).where(eq(documentRelations.id, id)).get()!);
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: document_relations/.test(error.message)) {
      return conflict('relationExists', 'Dieser Bezug besteht bereits');
    }
    throw error;
  }
}

export async function unrelateDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, unrelateSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documentRelations).where(eq(documentRelations.id, parsed.value.id)).get();
  if (!row) return notFound('documentRelation', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentRelations).where(eq(documentRelations.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.unrelate', entityType: 'documentRelation', entityId: row.id, before: row, summary: `Bezug ${row.id} gelöst` });
    return ok(null);
  });
}

/** Für das Löschen eines Dokuments: Bezüge in beiden Richtungen, in der Transaktion des Aufrufers. */
export function deleteRelationsFor(tx: DbOrTx, documentId: string): number {
  const a = tx.delete(documentRelations).where(eq(documentRelations.documentId, documentId)).run().changes;
  const b = tx.delete(documentRelations).where(eq(documentRelations.relatedDocumentId, documentId)).run().changes;
  return a + b;
}
