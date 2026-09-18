import {
  invalid,
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
import { documentTypeFor } from './catalog';
import { RELATION_KINDS, documentLinks, documentRelations, documents } from './schema';
import { removeDocumentFile, storeDocumentFile } from './storage';
import { allocateDocumentNumber, linkInputSchema, resolveFolder, toRecord, type DocumentRecord } from './service';

/**
 * Was jede Ablage eingehender Post beschreibt — unabhängig davon, woher die
 * Bytes kommen. Beide Schemata unten teilen sich diesen Bestand, damit der
 * Weg über MCP nichts annimmt, was der Service verwirft.
 */
const receiveFields = {
  filename: z.string().trim().min(1).max(255),
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  documentDate: z.string().date(),
  folder: z.string().trim().min(1).nullable().optional(),
  links: z.array(linkInputSchema).default([]),
  /** Bezüge zu anderen Dokumenten, gelesen von diesem aus (Entscheidung 33). */
  relations: z.array(z.object({ relatedDocumentId: z.string().min(1), kind: z.enum(RELATION_KINDS) })).default([]),
};

const oneSource = {
  message: 'entweder bytes oder contentBase64',
} as const;

/**
 * Was der Service annimmt: rohe Bytes aus der Oberfläche oder Base64 über MCP.
 * Kein `assetId` mehr: Die Akte legt ihre Dateien im eigenen Speicher ab, nicht
 * in der Mediathek — der Weg über ein Asset führte nie zu Bytes.
 */
export const receiveDocumentSchema = z
  .object({
    ...receiveFields,
    bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }).optional(),
    contentBase64: z.string().optional(),
  })
  .refine((value) => Boolean(value.bytes) !== Boolean(value.contentBase64), oneSource);

/** Was MCP zeigt: derselbe Bestand ohne `bytes`, weil ein Agent nur JSON schickt. */
export const receiveSchema = z.object({
  ...receiveFields,
  /** Die Bytes als Base64. */
  contentBase64: z.string().min(1),
});

export async function receiveDocument(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, receiveDocumentSchema, input);
  if (!parsed.ok) return parsed;

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType) return notFound('documentType', parsed.value.typeKey);

  let bytes = parsed.value.bytes;
  if (!bytes && parsed.value.contentBase64) {
    bytes = Buffer.from(parsed.value.contentBase64, 'base64');
  }
  if (!bytes) return invalid([{ path: 'file', message: 'missingBytes' }]);

  const folderRes = resolveFolder(deps.db, parsed.value.folder, docType.defaultFolder ?? null);
  if (!folderRes.ok) return folderRes;
  const folder = folderRes.value;

  for (const relation of parsed.value.relations) {
    const other = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, relation.relatedDocumentId)).get();
    if (!other) return notFound('document', relation.relatedDocumentId);
  }

  const id = newId();
  const now = isoNow(deps.clock);
  const year = deps.clock.now().getUTCFullYear();

  // Die Datei zuerst: Ihr Schreiben kann scheitern, und dann darf keine Zeile
  // da sein. Scheitert danach die Transaktion, wird sie wieder entfernt.
  const stored = await storeDocumentFile(deps, id, bytes);
  if (!stored.ok) return stored;

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const number = allocateDocumentNumber(tx, docType.prefix, year);
      tx.insert(documents)
        .values({
          id,
          phase: 'issued',
          direction: 'incoming',
          sourceKind: 'uploaded',
          typeKey: docType.key,
          number,
          subject: parsed.value.subject,
          documentDate: parsed.value.documentDate,
          folder,
          draftBody: null,
          templateKey: null,
          inputSnapshot: null,
          fileName: stored.value.fileName,
          fileChecksum: stored.value.fileChecksum,
          fileBytes: stored.value.fileBytes,
          textStatus: 'pending',
          textAttempts: 0,
          textError: null,
          textExtractedAt: null,
          status: 'issued',
          createdByUserId: ctx.userId ?? 'system',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const link of parsed.value.links) {
        tx.insert(documentLinks)
          .values({
            id: newId(),
            documentId: id,
            entityType: link.entityType,
            entityId: link.entityId,
            role: link.role,
            createdAt: now,
          })
          .run();
      }

      for (const relation of parsed.value.relations) {
        tx.insert(documentRelations)
          .values({
            id: newId(),
            documentId: id,
            relatedDocumentId: relation.relatedDocumentId,
            kind: relation.kind,
            createdByUserId: ctx.userId ?? 'system',
            createdAt: now,
          })
          .run();
      }

      recordAudit(tx, deps, ctx, {
        action: 'dms.receive',
        entityType: 'document',
        entityId: id,
        after: { number, typeKey: docType.key, subject: parsed.value.subject, relations: parsed.value.relations.length },
        summary: `Dokument ${number} („${parsed.value.subject}“) eingegangen`,
      });

      const row = tx.select().from(documents).where(eq(documents.id, id)).get()!;
      return ok(toRecord(deps, row, tx));
    });
  } catch (error) {
    await removeDocumentFile(deps, stored.value.fileName);
    throw error;
  }
}
