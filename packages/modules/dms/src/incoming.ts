import {
  conflict,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
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
import { nextDocumentNumber, toRecord, type DocumentRecord } from './service';

export const receiveDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  documentDate: z.string().date(),
  folder: z.string().trim().min(1).nullable().optional(),
  links: z
    .array(
      z.object({
        entityType: z.string().trim().min(1).max(60),
        entityId: z.string().trim().min(1),
        role: z.enum(['sender', 'recipient', 'about']),
      }),
    )
    .default([]),
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

  ensureDocumentFolder(deps, ctx);

  const asset = await storeMediaInternal(deps, ctx, {
    originalName: parsed.value.filename,
    bytes: parsed.value.bytes,
    folder: DOCUMENT_FOLDER,
  });
  if (!asset.ok) return asset;

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
            assetId: asset.value.id,
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
