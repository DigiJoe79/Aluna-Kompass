import {
  buildContext,
  conflict,
  isoNow,
  newId,
  notFound,
  ok,
  prepare,
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
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { resolveRecipient } from './recipients';
import { documentLinks, documents } from './schema';
import { nextDocumentNumber, toRecord, type DocumentRecord } from './service';

export const draftCreateSchema = z.object({
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(100_000).default(''),
  documentDate: z.string().date().optional(),
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

export const draftUpdateSchema = z.object({
  id: z.string().min(1),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().max(100_000).optional(),
  documentDate: z.string().date().optional(),
  folder: z.string().trim().min(1).nullable().optional(),
  /**
   * Der Empfänger, nicht die ganze Bezugsliste: Ein Tippfehler in der Anschrift
   * darf nicht die Bezüge kosten, die jemand über `dms_link` gesetzt hat.
   * Fehlt das Feld, bleibt der Empfänger stehen; `null` nimmt ihn weg.
   */
  recipientId: z.string().trim().min(1).nullable().optional(),
});

export const draftDeleteSchema = z.object({
  id: z.string().min(1),
});

export const draftPreviewSchema = z.object({
  id: z.string().min(1),
});

export const fileDocumentSchema = z.object({
  id: z.string().min(1),
});

/** Der freie Brief trägt jede Art, die keine eigene Vorlage mitbringt. */
export const FALLBACK_TEMPLATE_KEY = 'letter';

/**
 * Eine Dokumentart benutzt die Vorlage, die ihren Schlüssel trägt — bringt kein
 * Modul eine mit, bleibt der freie Brief. So bekommt eine später ergänzte
 * Vorlage ihre Art von selbst, ohne dass hier eine Liste gepflegt wird.
 */
export function templateKeyForType(deps: Deps, typeKey: string): string {
  return deps.registry.documentTemplates.has(typeKey) ? typeKey : FALLBACK_TEMPLATE_KEY;
}

export async function createDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, draftCreateSchema, input);
  if (!parsed.ok) return parsed;

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType) return notFound('documentType', parsed.value.typeKey);

  const id = newId();
  const now = isoNow(deps.clock);
  const documentDate = parsed.value.documentDate ?? now.slice(0, 10);
  const folder = parsed.value.folder !== undefined ? parsed.value.folder : docType.defaultFolder;

  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(documents)
      .values({
        id,
        phase: 'draft',
        direction: docType.defaultDirection,
        sourceKind: 'generated',
        typeKey: docType.key,
        number: null,
        subject: parsed.value.subject,
        documentDate,
        folder,
        draftBody: parsed.value.body,
        templateKey: templateKeyForType(deps, docType.key),
        inputSnapshot: null,
        assetId: null,
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
      action: 'dms.draft.create',
      entityType: 'documentDraft',
      entityId: id,
      after: { typeKey: docType.key, subject: parsed.value.subject },
      summary: `Entwurf „${parsed.value.subject}“ angelegt`,
    });

    const row = tx.select().from(documents).where(eq(documents.id, id)).get()!;
    return ok(toRecord(deps, row, tx));
  });
}

export async function updateDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, draftUpdateSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);

  if (row.phase !== 'draft') {
    return conflict('documentIsFiled', `Dokument ${row.number ?? row.id} ist bereits festgeschrieben`);
  }

  const updates: Partial<typeof documents.$inferInsert> = {
    updatedAt: isoNow(deps.clock),
  };
  if (parsed.value.subject !== undefined) updates.subject = parsed.value.subject;
  if (parsed.value.body !== undefined) updates.draftBody = parsed.value.body;
  if (parsed.value.documentDate !== undefined) updates.documentDate = parsed.value.documentDate;
  if (parsed.value.folder !== undefined) updates.folder = parsed.value.folder;

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set(updates).where(eq(documents.id, row.id)).run();

    if (parsed.value.recipientId !== undefined) {
      tx.delete(documentLinks)
        .where(and(eq(documentLinks.documentId, row.id), eq(documentLinks.role, 'recipient')))
        .run();
      if (parsed.value.recipientId !== null) {
        tx.insert(documentLinks)
          .values({
            id: newId(),
            documentId: row.id,
            entityType: 'contact',
            entityId: parsed.value.recipientId,
            role: 'recipient',
            createdAt: isoNow(deps.clock),
          })
          .run();
      }
    }

    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;

    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.update',
      entityType: 'documentDraft',
      entityId: row.id,
      before: { subject: row.subject },
      after: { subject: after.subject },
      summary: `Entwurf „${after.subject}“ geändert`,
    });

    return ok(toRecord(deps, after, tx));
  });
}

export async function deleteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.deleteDraft');
  if (denied) return denied;

  const parsed = validate(deps, draftDeleteSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);

  if (row.phase === 'issued') {
    return conflict('documentIsFiled', `Dokument ${row.number ?? row.id} ist bereits festgeschrieben`);
  }

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentLinks).where(eq(documentLinks.documentId, row.id)).run();
    tx.delete(documents).where(eq(documents.id, row.id)).run();

    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.delete',
      entityType: 'documentDraft',
      entityId: row.id,
      before: { subject: row.subject, typeKey: row.typeKey },
      summary: `Entwurf „${row.subject}“ gelöscht`,
    });

    return ok(null);
  });
}

export async function previewDraft(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const parsed = validate(deps, draftPreviewSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);

  const recipient = resolveRecipient(deps, row.id);
  const templateKey = row.templateKey ?? FALLBACK_TEMPLATE_KEY;

  const prepared = await prepare(deps, ctx, {
    templateKey,
    input: { subject: row.subject, body: row.draftBody ?? '', recipient },
  });
  if (!prepared.ok) return prepared;

  const { built, baseId, bodyTypst } = prepared.value;
  const context = await buildContext(deps, ctx, '');
  const bytes = await deps.documents.render({
    baseId,
    bodyTypst,
    slots: { ...built.slots, draft: true },
    context,
  });

  const filename = `${(row.subject || 'Entwurf').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Entwurf'}-Vorschau.pdf`;

  deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.preview',
      entityType: 'documentDraft',
      entityId: row.id,
      after: { templateKey, subject: row.subject },
      summary: `Vorschau für Entwurf „${row.subject}“ erzeugt`,
    });
  });

  return ok({ bytes, filename, mimeType: 'application/pdf' });
}

export const DOCUMENT_FOLDER = 'Dokumente';

export function ensureDocumentFolder(deps: Deps, ctx: CallContext) {
  const existing = deps.db
    .select()
    .from(schema.mediaFolders)
    .where(eq(schema.mediaFolders.path, DOCUMENT_FOLDER))
    .get();

  if (!existing) {
    deps.db.transaction((tx: DbOrTx) => {
      tx.insert(schema.mediaFolders)
        .values({ path: DOCUMENT_FOLDER, createdAt: isoNow(deps.clock) })
        .run();
      recordAudit(tx, deps, ctx, {
        action: 'media.folder.create',
        entityType: 'mediaFolder',
        entityId: DOCUMENT_FOLDER,
        after: { path: DOCUMENT_FOLDER },
        summary: `Ordner „${DOCUMENT_FOLDER}“ angelegt`,
      });
    });
  }
}

export async function fileDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.file');
  if (denied) return denied;

  const parsed = validate(deps, fileDocumentSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);

  if (row.phase === 'issued') {
    return conflict('documentIsFiled', `Dokument ${row.number ?? row.id} ist bereits festgeschrieben`);
  }

  const docType = documentTypeFor(deps.db, row.typeKey);
  if (!docType) return notFound('documentType', row.typeKey);

  const templateKey = row.templateKey ?? FALLBACK_TEMPLATE_KEY;
  const recipient = resolveRecipient(deps, row.id);

  const prepared = await prepare(deps, ctx, {
    templateKey,
    input: { subject: row.subject, body: row.draftBody ?? '', recipient },
  });
  if (!prepared.ok) return prepared;

  const { data, built, baseId, base, bodyTypst } = prepared.value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const number = nextDocumentNumber(deps.db, docType.prefix, year);
    const context = await buildContext(deps, ctx, number);
    const bytes = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });

    ensureDocumentFolder(deps, ctx);

    const asset = await storeMediaInternal(deps, ctx, {
      originalName: `${number}.pdf`,
      bytes,
      declaredMimeType: 'application/pdf',
      folder: DOCUMENT_FOLDER,
    });
    if (!asset.ok) return asset;

    const snapshot = { input: data, slots: built.slots, base: baseId, baseChecksum: base.checksum };
    try {
      return deps.db.transaction((tx: DbOrTx) => {
        const now = isoNow(deps.clock);
        tx.update(documents)
          .set({
            phase: 'issued',
            number,
            assetId: asset.value.id,
            inputSnapshot: JSON.stringify(snapshot),
            draftBody: null,
            updatedAt: now,
          })
          .where(eq(documents.id, row.id))
          .run();

        const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
        recordAudit(tx, deps, ctx, {
          action: 'dms.file',
          entityType: 'document',
          entityId: row.id,
          after: { number, templateKey, base: baseId },
          summary: `Dokument ${number} festgeschrieben`,
        });
        return ok(toRecord(deps, after, tx));
      });
    } catch (error) {
      if (!(error instanceof Error && /UNIQUE constraint failed: documents\.number/.test(error.message))) {
        throw error;
      }
    }
  }

  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
}
