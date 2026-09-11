import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import {
  conflict,
  deleteMediaAsset,
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
  schema,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type MediaReference,
  type Result,
} from '@kompass/core';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { documentFolders, documentLinks, documents, type DocumentLinkRow, type DocumentRow } from './schema';

/**
 * Wo dieses Modul ein Medium verwendet — das PDF eines Dokuments. Ohne diesen
 * Haken ließe sich das PDF eines festgeschriebenen Dokuments aus der
 * Mediathek löschen, obwohl es der rechenschaftsrelevante Datensatz ist
 * (§ 4 der Spec, Prinzip 3). Befragt vor dem Löschen eines Assets.
 */
export function dmsMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return deps.db
    .select({ id: documents.id, number: documents.number, subject: documents.subject })
    .from(documents)
    .where(eq(documents.assetId, assetId))
    .all()
    .map((row) => ({ label: `Dokument ${row.number ?? row.subject}`, entity: 'document', id: row.id }));
}

export type DocumentRecord = Omit<DocumentRow, 'inputSnapshot'> & { inputSnapshot: unknown; links: DocumentLinkRow[] };

export function toRecord(deps: Deps, row: DocumentRow, dbOrTx: DbOrTx = deps.db): DocumentRecord {
  const links = dbOrTx.select().from(documentLinks).where(eq(documentLinks.documentId, row.id)).all();
  return { ...row, inputSnapshot: row.inputSnapshot ? JSON.parse(row.inputSnapshot) : null, links };
}

/**
 * Präfix kommt aus der Dokumentart (Entscheidung 18); Format und Lückenlosigkeit
 * je Präfix und Jahr. Maßgeblich ist die **höchste** vergebene Nummer, nicht die
 * Anzahl der Zeilen: Nach einer Löschung wegen Fristablauf gibt es weniger
 * Zeilen als vergebene Nummern, und ein Zähler liefe erneut auf eine schon
 * belegte Nummer — die Ablage bliebe bis zum Jahreswechsel stehen.
 *
 * Das Jahr in der Nummer ist das **Ablagejahr** (`clock.now()`), die Frist
 * rechnet ab `documentDate`. Im Normalbetrieb liegen beide beieinander und ein
 * Dokument wird erst fällig, wenn der Zähler seines Jahres längst ruht. Sie
 * fallen auseinander, wenn Altbestand eingescannt wird — eine Rechnung von 2005
 * bekommt eine Nummer von heute und ist sofort fällig — oder wenn jemand eine
 * Aufbewahrungseinstellung senkt. Nur dort trifft eine Löschung den Zähler des
 * laufenden Jahres.
 *
 * Verschwindet dabei der **letzte** Eintrag eines Präfixes und Jahres, beginnt
 * die Zählung wieder bei 001. Das ist bewusst so: ein Gedächtnis über gelöschte
 * Zeilen hinaus wäre ein gespeicherter abgeleiteter Wert (Prinzip 5), und die
 * freigewordene Nummer hängt an keinem Dokument mehr.
 */
export function nextDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const start = `${prefix}-${year}-`;
  const taken = db
    .select({ number: documents.number })
    .from(documents)
    .where(sql`${documents.number} like ${`${start}%`}`)
    .all();

  let highest = 0;
  for (const row of taken) {
    const suffix = row.number?.slice(start.length) ?? '';
    if (!/^\d+$/.test(suffix)) continue;
    highest = Math.max(highest, Number.parseInt(suffix, 10));
  }

  return `${start}${String(highest + 1).padStart(3, '0')}`;
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

export async function listDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documents: DocumentRecord[]; total: number }>> {
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
  if (q.text) conditions.push(or(like(documents.subject, `%${q.text}%`), like(documents.number, `%${q.text}%`)) as SQL);
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
  return ok({ documents: rows.map((row) => toRecord(deps, row)), total });
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
  if (!row.assetId) return notFound('mediaAsset', id);
  const asset = deps.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, row.assetId)).get();
  if (!asset) return notFound('mediaAsset', row.assetId);
  return ok({ record: toRecord(deps, row), bytes: await deps.media.read(asset.filename), filename: `${row.number}.pdf` });
}

const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });

export async function voidDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.void');
  if (denied) return denied;
  const parsed = validate(deps, voidSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (row.status === 'voided') return conflict('documentAlreadyVoided', `Dokument ${row.number} ist bereits storniert`);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ status: 'voided', voidedAt: isoNow(deps.clock), voidedByUserId: ctx.userId, voidReason: parsed.value.reason }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, { action: 'dms.void', entityType: 'document', entityId: row.id, before: { status: 'issued' }, after: { status: 'voided', reason: parsed.value.reason }, summary: `Dokument ${row.number} storniert: ${parsed.value.reason}` });
    return ok(toRecord(deps, after));
  });
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

  let targetFolder: string | null = null;
  if (parsed.value.folder !== null) {
    const normalized = parseFolderPath(parsed.value.folder);
    if (!normalized) return invalid([{ path: 'folder', message: 'invalidFolderPath' }]);
    const folderRow = deps.db.select().from(documentFolders).where(eq(documentFolders.path, normalized)).get();
    if (!folderRow) return notFound('documentFolder', parsed.value.folder);
    targetFolder = normalized;
  }

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
        assetId: doc.assetId,
      },
      summary: `Dokument ${doc.number ?? doc.subject} gelöscht`,
    });

    tx.delete(documentLinks).where(eq(documentLinks.documentId, doc.id)).run();
    tx.delete(documents).where(eq(documents.id, doc.id)).run();
  });

  if (doc.assetId) {
    const mediaCtx = ctx.permissions.has('media.upload')
      ? ctx
      : { ...ctx, permissions: new Set([...ctx.permissions, 'media.upload']) };
    await deleteMediaAsset(deps, mediaCtx, { id: doc.assetId });
  }

  return ok(null);
}


