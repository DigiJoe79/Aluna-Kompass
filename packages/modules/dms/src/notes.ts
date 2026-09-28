import {
  forbidden,
  hasPermission,
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
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAreaAccess } from './access';
import { auditDocumentRef } from './audit-ref';
import { documentNotes, documents, type DocumentNoteRow } from './schema';

export const noteAddSchema = z.object({ documentId: z.string().min(1), body: z.string().trim().min(1).max(4000) });
export const noteIdSchema = z.object({ id: z.string().min(1) });

export function notesFor(db: DbOrTx, documentId: string): DocumentNoteRow[] {
  return db.select().from(documentNotes).where(eq(documentNotes.documentId, documentId)).orderBy(asc(documentNotes.createdAt), asc(documentNotes.id)).all();
}

export async function addNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentNoteRow>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, noteAddSchema, input);
  if (!parsed.ok) return parsed;
  const doc = deps.db.select({ id: documents.id, number: documents.number, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);
  const unreadable = requireAreaAccess(deps, ctx, doc);
  if (unreadable) return unreadable;

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(documentNotes).values({ id, documentId: doc.id, body: parsed.value.body, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock) }).run();
    // Der Text der Notiz steht nicht im Protokoll: Sie ist Arbeitsmaterial,
    // und ihr Inhalt geht mit ihr (wie beim Entwurf, Entscheidung 4).
    const ref = auditDocumentRef(tx, doc);
    recordAudit(tx, deps, ctx, { action: 'dms.note.add', entityType: 'documentNote', entityId: id, after: { documentId: doc.id }, summary: `Notiz an ${ref.hidden ? ref.name : (doc.number ?? doc.subject)} angefügt` });
    return ok(tx.select().from(documentNotes).where(eq(documentNotes.id, id)).get()!);
  });
}

/** Die eigene Notiz löscht, wer sie schrieb (mit `dms.create`); eine fremde nur, wer verwaltet. */
export async function deleteNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, noteIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documentNotes).where(eq(documentNotes.id, parsed.value.id)).get();
  if (!row) return notFound('documentNote', parsed.value.id);
  const doc = deps.db.select({ typeKey: documents.typeKey }).from(documents).where(eq(documents.id, row.documentId)).get();
  if (doc) {
    const unreadable = requireAreaAccess(deps, ctx, doc);
    if (unreadable) return unreadable;
  }
  if (row.createdByUserId !== ctx.userId && !hasPermission(ctx, 'dms.manage')) return forbidden('dms.manage');

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentNotes).where(eq(documentNotes.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.note.delete', entityType: 'documentNote', entityId: row.id, before: { documentId: row.documentId, createdByUserId: row.createdByUserId }, summary: `Notiz ${row.id} gelöscht` });
    return ok(null);
  });
}

export function deleteNotesFor(tx: DbOrTx, documentId: string): number {
  return tx.delete(documentNotes).where(eq(documentNotes.documentId, documentId)).run().changes;
}
