import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import {
  conflict,
  invalid,
  isoNow,
  newId,
  notFound,
  ok,
  parseFolderPath,
  recordAudit,
  requirePermission,
  retentionEnd,
  retentionMonths,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { documentCounters, documentFolders, documentLinks, documents, type DocumentLinkRow, type DocumentRow } from './schema';
import { readDocumentFile, removeDocumentFile } from './storage';
import { removeDocumentText } from './index-store';
import { fulltextCondition, fulltextHits, type TextHit } from './search';
import { deleteRelationsFor, relationsFor, type DocumentRelationView } from './relations';

export type DocumentRecord = Omit<DocumentRow, 'inputSnapshot'> & {
  inputSnapshot: unknown;
  links: DocumentLinkRow[];
  relations: DocumentRelationView[];
};

export function toRecord(deps: Deps, row: DocumentRow, dbOrTx: DbOrTx = deps.db): DocumentRecord {
  const links = dbOrTx.select().from(documentLinks).where(eq(documentLinks.documentId, row.id)).all();
  return {
    ...row,
    inputSnapshot: row.inputSnapshot ? JSON.parse(row.inputSnapshot) : null,
    links,
    relations: relationsFor(dbOrTx, row.id),
  };
}

const format = (prefix: string, year: number, n: number) => `${prefix}-${year}-${String(n).padStart(3, '0')}`;

/**
 * Präfix aus der Dokumentart (Entscheidung 18), Jahr ist das Ablagejahr.
 * Der Zähler ist Zustand (Entscheidung 38): Eine Nummer, deren Dokument nach
 * Fristablauf gelöscht wurde, kommt nie wieder — das Protokoll nennt sie, und
 * sie darf kein zweites Dokument bezeichnen.
 *
 * Nur in einer Transaktion aufrufen: Lesen und Erhöhen müssen zusammen
 * stehen. better-sqlite3 führt Transaktionen nacheinander aus, ein zweiter
 * Aufruf sieht also immer den erhöhten Stand.
 */
export function allocateDocumentNumber(tx: DbOrTx, prefix: string, year: number): string {
  const row = tx.select().from(documentCounters).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).get();
  const next = (row?.last ?? 0) + 1;
  if (row) {
    tx.update(documentCounters).set({ last: next }).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).run();
  } else {
    tx.insert(documentCounters).values({ prefix, year, last: next }).run();
  }
  return format(prefix, year, next);
}

/** Die Nummer, die das nächste Dokument bekäme — ein Blick, kein Zug. */
export function peekDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const row = db.select().from(documentCounters).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).get();
  return format(prefix, year, (row?.last ?? 0) + 1);
}

export const previewNumberSchema = z.object({
  typeKey: z.string().trim().min(1),
});

/**
 * Die Nummer, die das nächste Dokument dieser Art bekäme. Ein reiner Blick:
 * Gezogen wird die Nummer erst beim Ablegen, aus dem Zähler. Zwischen Ansehen
 * und Ablegen kann jemand anders schneller sein — deshalb sagt die Oberfläche
 * „wird beim Ablegen gezogen“ und nicht „ist Ihre“.
 */
export async function previewNextNumber(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ number: string }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const parsed = validate(deps, previewNumberSchema, input);
  if (!parsed.ok) return parsed;

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType) return notFound('documentType', parsed.value.typeKey);

  const year = deps.clock.now().getUTCFullYear();
  return ok({ number: peekDocumentNumber(deps.db, docType.prefix, year) });
}

export const documentListSchema = z.object({
  direction: z.enum(['outgoing', 'incoming']).optional(),
  phase: z.enum(['draft', 'issued']).optional(),
  typeKey: z.string().min(1).optional(),
  folder: z.string().nullable().optional(), // null = Eingangskorb
  inbox: z.boolean().optional(),
  linkedTo: z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }).optional(),
  text: z.string().trim().min(1).optional(), // Betreff oder Nummer
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export async function listDocuments(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ documents: DocumentRecord[]; total: number; fulltextTooShort: boolean; hits: Record<string, TextHit> }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentListSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.direction) conditions.push(eq(documents.direction, q.direction));
  if (q.phase) conditions.push(eq(documents.phase, q.phase));
  if (q.typeKey) conditions.push(eq(documents.typeKey, q.typeKey));
  if (q.inbox) conditions.push(sql`${documents.folder} is null`);
  else if (q.folder !== undefined) conditions.push(q.folder === null ? sql`${documents.folder} is null` : eq(documents.folder, q.folder));

  let fulltextTooShort = false;
  if (q.text) {
    const inFulltext = fulltextCondition(q.text);
    fulltextTooShort = inFulltext === null;
    const byText = or(like(documents.subject, `%${q.text}%`), like(documents.number, `%${q.text}%`));
    // Der Volltext erweitert die Treffermenge, nicht die Reihenfolge
    // (Entscheidung 31): Die Liste bleibt chronologisch, `total`, `limit` und
    // `offset` bleiben, wie sie waren.
    conditions.push((inFulltext ? or(byText, inFulltext) : byText) as SQL);
  }

  if (q.linkedTo) {
    const ids = deps.db
      .select({ id: documentLinks.documentId })
      .from(documentLinks)
      .where(and(eq(documentLinks.entityType, q.linkedTo.entityType), eq(documentLinks.entityId, q.linkedTo.entityId)))
      .all()
      .map((r) => r.id);
    conditions.push(inArray(documents.id, ids.length > 0 ? ids : ['__none__']));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const rows = deps.db.select().from(documents).where(where).orderBy(desc(documents.createdAt), desc(documents.number)).limit(q.limit).offset(q.offset).all();

  // Erst blättern, dann Passagen holen: Für fünfzig Zeilen braucht niemand
  // die Fundstellen von fünfhundert.
  const hits = q.text ? fulltextHits(deps, rows.map((r) => r.id), q.text) : new Map<string, TextHit>();

  return ok({
    documents: rows.map((row) => toRecord(deps, row)),
    total,
    fulltextTooShort,
    hits: Object.fromEntries(hits),
  });
}

export async function getDocumentRecord(deps: Deps, ctx: CallContext, id: string): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  return ok(toRecord(deps, row));
}

export async function getDocument(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: DocumentRecord; bytes: Uint8Array; filename: string }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  if (!row.fileName) return notFound('documentFile', id);
  return ok({ record: toRecord(deps, row), bytes: await readDocumentFile(deps, row.fileName), filename: `${row.number}.pdf` });
}

const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });

export async function voidDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.void');
  if (denied) return denied;
  const parsed = validate(deps, voidSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (row.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${row.subject}“ kann nicht storniert werden — nur verworfen`);
  if (row.status === 'voided') return conflict('documentAlreadyVoided', `Dokument ${row.number} ist bereits storniert`);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ status: 'voided', voidedAt: isoNow(deps.clock), voidedByUserId: ctx.userId, voidReason: parsed.value.reason }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, { action: 'dms.void', entityType: 'document', entityId: row.id, before: { status: 'issued' }, after: { status: 'voided', reason: parsed.value.reason }, summary: `Dokument ${row.number} storniert: ${parsed.value.reason}` });
    return ok(toRecord(deps, after));
  });
}

/**
 * Ein Ordner, der im Formular steht, muss in `document_folders` stehen — sonst
 * landet ein Dokument an einem Ort, den die Ordnerspalte nie zeigt. Dieselbe
 * Regel für Ablegen, Entwurf und Verschieben.
 */
export function resolveFolder(db: DbOrTx, folder: string | null | undefined, fallback: string | null): Result<string | null> {
  if (folder === undefined) return ok(fallback);
  if (folder === null) return ok(null);
  const normalized = parseFolderPath(folder);
  if (!normalized) return invalid([{ path: 'folder', message: 'invalidFolderPath' }]);
  const row = db.select({ path: documentFolders.path }).from(documentFolders).where(eq(documentFolders.path, normalized)).get();
  if (!row) return notFound('documentFolder', folder);
  return ok(normalized);
}

export const moveDocumentSchema = z.object({
  id: z.string().min(1),
  folder: z.string().min(1).nullable(),
});

export async function moveDocument(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, moveDocumentSchema, input);
  if (!parsed.ok) return parsed;

  const doc = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!doc) return notFound('document', parsed.value.id);

  const resolved = resolveFolder(deps.db, parsed.value.folder, null);
  if (!resolved.ok) return resolved;
  const targetFolder = resolved.value;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(documents).set({ folder: targetFolder, updatedAt: now }).where(eq(documents.id, doc.id)).run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.move',
      entityType: 'document',
      entityId: doc.id,
      before: { folder: doc.folder },
      after: { folder: targetFolder },
      summary: `Dokument ${doc.number ?? doc.subject} nach „${targetFolder ?? 'Eingangskorb'}“ verschoben`,
    });

    const after = tx.select().from(documents).where(eq(documents.id, doc.id)).get()!;
    return ok(toRecord(deps, after, tx));
  });
}

export const linkInputSchema = z.object({
  entityType: z.string().trim().min(1).max(60),
  entityId: z.string().trim().min(1),
  role: z.enum(['sender', 'recipient', 'about']),
});

export const linkSchema = linkInputSchema.extend({
  documentId: z.string().min(1),
});

export async function linkDocument(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentLinkRow>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;

  const doc = deps.db.select().from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);

  const id = newId();
  const now = isoNow(deps.clock);

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      tx.insert(documentLinks)
        .values({
          id,
          documentId: parsed.value.documentId,
          entityType: parsed.value.entityType,
          entityId: parsed.value.entityId,
          role: parsed.value.role,
          createdAt: now,
        })
        .run();

      recordAudit(tx, deps, ctx, {
        action: 'dms.link',
        entityType: 'documentLink',
        entityId: id,
        after: {
          documentId: parsed.value.documentId,
          entityType: parsed.value.entityType,
          entityId: parsed.value.entityId,
          role: parsed.value.role,
        },
        summary: `Bezug zu ${parsed.value.entityType}:${parsed.value.entityId} angelegt`,
      });

      const row = tx.select().from(documentLinks).where(eq(documentLinks.id, id)).get()!;
      return ok(row);
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: document_links/.test(error.message)) {
      return conflict('linkExists', 'Bezug existiert bereits');
    }
    throw error;
  }
}

export const unlinkSchema = z.object({
  id: z.string().min(1),
});

export async function unlinkDocument(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, unlinkSchema, input);
  if (!parsed.ok) return parsed;

  const link = deps.db.select().from(documentLinks).where(eq(documentLinks.id, parsed.value.id)).get();
  if (!link) return notFound('documentLink', parsed.value.id);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentLinks).where(eq(documentLinks.id, link.id)).run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.unlink',
      entityType: 'documentLink',
      entityId: link.id,
      before: {
        documentId: link.documentId,
        entityType: link.entityType,
        entityId: link.entityId,
        role: link.role,
      },
      summary: `Bezug ${link.id} gelöscht`,
    });

    return ok(null);
  });
}

export const deleteDocumentSchema = z.object({
  id: z.string().min(1),
});

export async function deleteDocument(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, deleteDocumentSchema, input);
  if (!parsed.ok) return parsed;

  const doc = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!doc) return notFound('document', parsed.value.id);
  if (doc.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${doc.subject}“ unterliegt keiner Frist — Entwürfe werden verworfen`);

  const docType = documentTypeFor(deps.db, doc.typeKey);
  if (!docType) return notFound('documentType', doc.typeKey);

  if (docType.retentionClass === 'permanent') {
    return conflict('retentionRunning', `Dokument ${doc.number ?? doc.id} unterliegt dauerhafter Aufbewahrung`);
  }

  const months = retentionMonths(deps, docType.retentionClass);
  if (months === null) {
    return conflict('retentionRunning', `Aufbewahrungsfrist für ${doc.number ?? doc.id} ist nicht konfiguriert`);
  }

  const until = retentionEnd(doc.documentDate, months);
  const today = deps.clock.now().toISOString().slice(0, 10);
  if (until >= today) {
    return conflict('retentionRunning', `Aufbewahrungsfrist für Dokument ${doc.number ?? doc.id} läuft noch bis ${until}`);
  }

  deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, {
      action: 'dms.delete',
      entityType: 'document',
      entityId: doc.id,
      before: {
        id: doc.id,
        number: doc.number,
        subject: doc.subject,
        typeKey: doc.typeKey,
        documentDate: doc.documentDate,
        folder: doc.folder,
        fileChecksum: doc.fileChecksum,
      },
      summary: `Dokument ${doc.number ?? doc.subject} gelöscht`,
    });

    deleteRelationsFor(tx, doc.id);
    tx.delete(documentLinks).where(eq(documentLinks.documentId, doc.id)).run();
    tx.delete(documents).where(eq(documents.id, doc.id)).run();
  });

  removeDocumentText(deps, doc.id);

  // Die Datei gehört diesem Modul, nicht der Mediathek: Kein fremder Dienst,
  // kein fremdes Recht, kein Kontext, dem hier etwas untergeschoben wird.
  if (doc.fileName) await removeDocumentFile(deps, doc.fileName);

  return ok(null);
}


