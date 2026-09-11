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
import { documentTypeFor } from './catalog';
import { documentLinks, documents } from './schema';
import { toRecord, type DocumentRecord } from './service';

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
});

export const draftDeleteSchema = z.object({
  id: z.string().min(1),
});

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
        templateKey: 'letter',
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
      summary: `Entwurf „${parsed.value.subject}" angelegt`,
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

    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;

    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.update',
      entityType: 'documentDraft',
      entityId: row.id,
      before: { subject: row.subject },
      after: { subject: after.subject },
      summary: `Entwurf „${after.subject}" geändert`,
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
      summary: `Entwurf „${row.subject}" gelöscht`,
    });

    return ok(null);
  });
}
