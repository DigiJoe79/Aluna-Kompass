import {
  conflict,
  invalid,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
  schema,
  storeMediaInternal,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { DOCUMENT_FOLDER, ensureDocumentFolder } from './drafts';
import { documentLinks, documents } from './schema';
import { linkInputSchema, nextDocumentNumber, toRecord, type DocumentRecord } from './service';

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
};

const oneSource = {
  message: 'entweder bytes, contentBase64 oder assetId',
} as const;

/** Was der Service annimmt: rohe Bytes aus der Oberfläche, Base64 oder ein vorhandenes Asset. */
export const receiveDocumentSchema = z
  .object({
    ...receiveFields,
    bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }).optional(),
    contentBase64: z.string().optional(),
    assetId: z.string().optional(),
  })
  .refine(
    (value) => (value.bytes ? 1 : 0) + (value.contentBase64 ? 1 : 0) + (value.assetId ? 1 : 0) === 1,
    oneSource,
  );

/** Was MCP zeigt: derselbe Bestand ohne `bytes`, weil ein Agent nur JSON schickt. */
export const receiveSchema = z
  .object({
    ...receiveFields,
    /** Entweder die Bytes als Base64 oder ein bereits abgelegtes Asset. */
    contentBase64: z.string().optional(),
    assetId: z.string().optional(),
  })
  .refine((value) => Boolean(value.contentBase64) !== Boolean(value.assetId), oneSource);

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

  let assetId: string;
  if (parsed.value.assetId) {
    const existingAsset = deps.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, parsed.value.assetId))
      .get();
    if (!existingAsset) return notFound('mediaAsset', parsed.value.assetId);
    assetId = existingAsset.id;
  } else {
    let bytes = parsed.value.bytes;
    if (!bytes && parsed.value.contentBase64) {
      bytes = Buffer.from(parsed.value.contentBase64, 'base64');
    }
    if (!bytes) return invalid([{ path: 'bytes', message: 'missingBytes' }]);

    ensureDocumentFolder(deps, ctx);
    const asset = await storeMediaInternal(deps, ctx, {
      originalName: parsed.value.filename,
      bytes,
      folder: DOCUMENT_FOLDER,
    });
    if (!asset.ok) return asset;
    assetId = asset.value.id;
  }

  const folder = parsed.value.folder !== undefined ? parsed.value.folder : (docType.defaultFolder ?? null);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const number = nextDocumentNumber(deps.db, docType.prefix, year);
    const id = newId();
    const now = isoNow(deps.clock);

    try {
      return deps.db.transaction((tx: DbOrTx) => {
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
            assetId,
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

        recordAudit(tx, deps, ctx, {
          action: 'dms.receive',
          entityType: 'document',
          entityId: id,
          after: { number, typeKey: docType.key, subject: parsed.value.subject },
          summary: `Dokument ${number} („${parsed.value.subject}“) eingegangen`,
        });

        const row = tx.select().from(documents).where(eq(documents.id, id)).get()!;
        return ok(toRecord(deps, row, tx));
      });
    } catch (error) {
      if (!(error instanceof Error && /UNIQUE constraint failed: documents\.number/.test(error.message))) {
        throw error;
      }
    }
  }

  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
}
