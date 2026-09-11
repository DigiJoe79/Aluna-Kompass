import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { conflict, isoNow, notFound, ok, recordAudit, requirePermission, schema, validate, type CallContext, type DbOrTx, type Deps, type MediaReference, type Result } from '@kompass/core';
import { z } from 'zod';
import { documentLinks, documents, type DocumentLinkRow, type DocumentRow } from './schema';

/**
 * Wo dieses Modul ein Medium verwendet — das PDF eines Dokuments. Ohne diesen
 * Haken ließe sich das PDF eines festgeschriebenen Dokuments aus der
 * Mediathek löschen, obwohl es der rechenschaftsrelevante Datensatz ist
 * (§ 4 der Spec, Prinzip 3). Befragt vor dem Löschen eines Assets.
 */
export function dmsMediaReferences(deps: Deps, assetId: string): MediaReference[] {
  return deps.db
    .select({ id: documents.id, number: documents.number })
    .from(documents)
    .where(eq(documents.assetId, assetId))
    .all()
    .map((d) => ({ label: `Dokument ${d.number ?? d.id}`, entity: 'document', id: d.id }));
}

export type DocumentRecord = Omit<DocumentRow, 'inputSnapshot'> & { inputSnapshot: unknown; links: DocumentLinkRow[] };

export function toRecord(deps: Deps, row: DocumentRow, dbOrTx: DbOrTx = deps.db): DocumentRecord {
  const links = dbOrTx.select().from(documentLinks).where(eq(documentLinks.documentId, row.id)).all();
  return { ...row, inputSnapshot: row.inputSnapshot ? JSON.parse(row.inputSnapshot) : null, links };
}

/** Präfix kommt aus der Dokumentart (Entscheidung 18); Format und Lückenlosigkeit je Präfix und Jahr. */
export function nextDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const row = db
    .select({ n: count() })
    .from(documents)
    .where(sql`${documents.number} like ${`${prefix}-${year}-%`}`)
    .get();
  return `${prefix}-${year}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
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
