import {
  yearIn,
  todayIn,
  buildContext,
  hasPermission,
  reservedLinkTypes,
  conflict,
  deleteFollowUpsFor,
  isoNow,
  newId,
  notFound,
  ok,
  prepare,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isProtectedType, requireAreaAccess, requireDmsGate, requireReadable } from './access';
import { auditDocumentRef } from './audit-ref';
import { defaultTypeKey, documentTypeFor } from './catalog';
import { refuseModuleOwned } from './owned';
import { responseSubject } from './response-subject';
import { resolveRecipient } from './recipients';
import { documentLinks, documents, type DocumentRow, type DocumentTypeRow } from './schema';
import { storeDocumentFile } from './storage';
import { allocateDocumentNumber, getDocumentRecord, peekDocumentNumber, refuseReservedLinks, resolveFolder, toRecord, type DocumentRecord } from './service';
import { removeDocumentText } from './index-store';
import { deleteNotesFor } from './notes';
import { deleteRelationsFor, insertRelation, relateDocuments } from './relations';

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

/**
 * Abbruch der Ablage-Transaktion: Die gezogene Nummer ist nicht die, die im
 * gerenderten PDF steht. Das Werfen rollt zurück; der nächste Anlauf rendert
 * neu. Eine eigene Klasse, damit der Fang nicht an einer Fehlermeldung hängt.
 */
export class NumberMovedOn extends Error {
  constructor() {
    super('number moved on between peek and draw');
    this.name = 'NumberMovedOn';
  }
}

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

  const reservedHit = refuseReservedLinks(deps, parsed.value.links);
  if (reservedHit) return reservedHit;

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType) return notFound('documentType', parsed.value.typeKey);

  const owned = refuseModuleOwned(docType);
  if (owned) return owned;

  // Ein Entwurf, den sein Autor nach dem Speichern nicht mehr sähe, wäre eine
  // Falle. Der Eingang ist anders: Dort ist das Dokument mit dem Ablegen fertig.
  const unreadable = requireAreaAccess(deps, ctx, { typeKey: docType.key });
  if (unreadable) return unreadable;

  const id = newId();
  const now = isoNow(deps.clock);
  // Der Tag des Vereins, nicht der UTC-Tag: Ein Brief von 0:30 Uhr trägt sonst den Vortag (`issuedOn`).
  const documentDate = parsed.value.documentDate ?? todayIn(deps);
  const folderRes = resolveFolder(deps.db, parsed.value.folder, docType.defaultFolder);
  if (!folderRes.ok) return folderRes;
  const folder = folderRes.value;

  return deps.db.transaction((tx: DbOrTx) => {
    const row = insertDraft(tx, deps, ctx, { id, docType, subject: parsed.value.subject, body: parsed.value.body, documentDate, folder, links: parsed.value.links, now });
    return ok(toRecord(deps, ctx, row, tx));
  });
}

interface DraftValues {
  id: string;
  docType: DocumentTypeRow;
  subject: string;
  body: string;
  documentDate: string;
  folder: string | null;
  links: readonly { entityType: string; entityId: string; role: 'sender' | 'recipient' | 'about' }[];
  now: string;
}

/** Zeile, Bezüge und Protokolleintrag eines neuen Entwurfs — in der Transaktion des Aufrufers. */
function insertDraft(tx: DbOrTx, deps: Deps, ctx: CallContext, v: DraftValues): DocumentRow {
  tx.insert(documents)
    .values({
      id: v.id,
      phase: 'draft',
      direction: v.docType.defaultDirection,
      sourceKind: 'generated',
      typeKey: v.docType.key,
      number: null,
      subject: v.subject,
      documentDate: v.documentDate,
      folder: v.folder,
      draftBody: v.body,
      templateKey: templateKeyForType(deps, v.docType.key),
      inputSnapshot: null,
      fileName: null,
      fileChecksum: null,
      fileBytes: null,
      status: 'issued',
      createdByUserId: ctx.userId ?? 'system',
      createdAt: v.now,
      updatedAt: v.now,
    })
    .run();

  for (const link of v.links) {
    tx.insert(documentLinks)
      .values({ id: newId(), documentId: v.id, entityType: link.entityType, entityId: link.entityId, role: link.role, createdAt: v.now })
      .run();
  }

  const row = tx.select().from(documents).where(eq(documents.id, v.id)).get()!;
  const ref = auditDocumentRef(tx, row);
  recordAudit(tx, deps, ctx, {
    action: 'dms.draft.create',
    entityType: 'documentDraft',
    entityId: v.id,
    after: { typeKey: v.docType.key },
  });
  return row;
}

export async function updateDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;

  const parsed = validate(deps, draftUpdateSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  const unreadable = requireAreaAccess(deps, ctx, row);
  if (unreadable) return unreadable;

  if (row.phase !== 'draft') {
    return conflict('documentIsFiled', `Dokument ${row.number ?? row.id} ist bereits festgeschrieben`);
  }

  const updates: Partial<typeof documents.$inferInsert> = {
    updatedAt: isoNow(deps.clock),
  };
  if (parsed.value.subject !== undefined) updates.subject = parsed.value.subject;
  if (parsed.value.body !== undefined) updates.draftBody = parsed.value.body;
  if (parsed.value.documentDate !== undefined) updates.documentDate = parsed.value.documentDate;
  if (parsed.value.folder !== undefined) {
    const folderRes = resolveFolder(deps.db, parsed.value.folder, null);
    if (!folderRes.ok) return folderRes;
    updates.folder = folderRes.value;
  }

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

    const ref = auditDocumentRef(tx, after);
    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.update',
      entityType: 'documentDraft',
      entityId: row.id,
      // Welche Felder, nie ihr Inhalt (Spec Protokoll § 2).
      after: { changedFields: (['subject', 'body'] as const).filter((field) => (field === 'subject' ? row.subject !== after.subject : row.draftBody !== after.draftBody)) },
    });

    return ok(toRecord(deps, ctx, after, tx));
  });
}

export async function deleteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.deleteDraft');
  if (denied) return denied;

  const parsed = validate(deps, draftDeleteSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  const unreadable = requireAreaAccess(deps, ctx, row);
  if (unreadable) return unreadable;

  if (row.phase === 'issued') {
    return conflict('documentIsFiled', `Dokument ${row.number ?? row.id} ist bereits festgeschrieben`);
  }

  deps.db.transaction((tx: DbOrTx) => {
    const removed = {
      relations: deleteRelationsFor(tx, row.id),
      notes: deleteNotesFor(tx, row.id),
      followUps: deleteFollowUpsFor(tx, 'document', row.id),
    };
    tx.delete(documentLinks).where(eq(documentLinks.documentId, row.id)).run();
    tx.delete(documents).where(eq(documents.id, row.id)).run();

    const ref = auditDocumentRef(tx, row);
    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.delete',
      entityType: 'documentDraft',
      entityId: row.id,
      before: { typeKey: row.typeKey, removed },
    });
  });

  removeDocumentText(deps, row.id);
  return ok(null);
}

export async function previewDraft(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string; pages: number | null }>> {
  const denied = requireDmsGate(deps, ctx);
  if (denied) return denied;

  const parsed = validate(deps, draftPreviewSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  const unreadable = requireReadable(deps, ctx, row);
  if (unreadable) return unreadable;

  const recipient = resolveRecipient(deps, row.id);
  const templateKey = row.templateKey ?? FALLBACK_TEMPLATE_KEY;

  const prepared = await prepare(deps, ctx, {
    templateKey,
    input: { subject: row.subject, body: row.draftBody ?? '', recipient },
  });
  if (!prepared.ok) return prepared;

  const { built, baseId, bodyTypst } = prepared.value;
  const context = await buildContext(deps, ctx, '', row.documentDate);
  const { bytes, pages } = await deps.documents.render({
    baseId,
    bodyTypst,
    slots: { ...built.slots, draft: true },
    context,
  });

  const filename = `${(row.subject || 'Entwurf').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Entwurf'}-Vorschau.pdf`;

  deps.db.transaction((tx: DbOrTx) => {
    const ref = auditDocumentRef(tx, row);
    recordAudit(tx, deps, ctx, {
      action: 'dms.draft.preview',
      entityType: 'documentDraft',
      entityId: row.id,
      after: { templateKey },
    });
  });

  return ok({ bytes, filename, mimeType: 'application/pdf', pages });
}

export async function fileDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.file');
  if (denied) return denied;

  const parsed = validate(deps, fileDocumentSchema, input);
  if (!parsed.ok) return parsed;

  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  const unreadable = requireAreaAccess(deps, ctx, row);
  if (unreadable) return unreadable;

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

  /**
   * Das PDF trägt die Nummer, also muss sie vor dem Rendern feststehen — und
   * gerendert wird asynchron, also außerhalb der Transaktion. Deshalb: ansehen,
   * rendern, schreiben, und in der Transaktion ziehen. Weicht die gezogene von
   * der angesehenen ab, war jemand dazwischen: zurückrollen und neu rendern.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = yearIn(deps);
    const expected = peekDocumentNumber(deps.db, docType.prefix, year);
    const context = await buildContext(deps, ctx, expected, row.documentDate);
    const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });

    // Die Datei trägt den Namen des Dokuments; ein zweiter Anlauf überschreibt
    // sie, es bleibt nichts liegen.
    const stored = await storeDocumentFile(deps, row.id, bytes);
    if (!stored.ok) return stored;

    const snapshot = { input: data, slots: built.slots, base: baseId, baseChecksum: base.checksum };
    let outcome: Result<DocumentRecord> | null = null;
    try {
      outcome = deps.db.transaction((tx: DbOrTx) => {
        const number = allocateDocumentNumber(tx, docType.prefix, year);
        if (number !== expected) throw new NumberMovedOn();
        const now = isoNow(deps.clock);
        tx.update(documents)
          .set({
            phase: 'issued',
            number,
            fileName: stored.value.fileName,
            fileChecksum: stored.value.fileChecksum,
            fileBytes: stored.value.fileBytes,
            textStatus: 'pending',
            textAttempts: 0,
            textError: null,
            textExtractedAt: null,
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
          params: { number },
        });
        return ok(toRecord(deps, ctx, after, tx));
      });
    } catch (error) {
      if (!(error instanceof NumberMovedOn)) throw error;
    }
    if (outcome) return outcome;
  }

  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
}

export const replacementSchema = z.object({ voidedId: z.string().min(1) });

/**
 * Nach dem Storno: derselbe Brief noch einmal, als Entwurf, mit Bezug
 * „ersetzt“. Der Text kommt aus dem eingefrorenen Eingabestand — nur bei
 * erzeugten Dokumenten; eingegangene Post hat keinen.
 */
export async function createReplacementDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, replacementSchema, input);
  if (!parsed.ok) return parsed;
  const old = deps.db.select().from(documents).where(eq(documents.id, parsed.value.voidedId)).get();
  if (!old) return notFound('document', parsed.value.voidedId);
  const unreadable = requireAreaAccess(deps, ctx, old);
  if (unreadable) return unreadable;
  if (old.status !== 'voided') return conflict('documentNotVoided', `Dokument ${old.number ?? old.subject} ist nicht storniert`);

  const snapshot = old.inputSnapshot ? (JSON.parse(old.inputSnapshot) as { input?: { body?: string } }) : null;
  const body = old.sourceKind === 'generated' ? (snapshot?.input?.body ?? '') : '';
  const links = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, old.id)).all().map((l) => ({ entityType: l.entityType, entityId: l.entityId, role: l.role }));

  const created = await createDraft(deps, ctx, { typeKey: old.typeKey, subject: old.subject, body, folder: old.folder, links });
  if (!created.ok) return created;
  const related = await relateDocuments(deps, ctx, { documentId: created.value.id, relatedDocumentId: old.id, kind: 'replaces' });
  if (!related.ok) return related;
  return getDocumentRecord(deps, ctx, created.value.id);
}

export const responseSchema = z.object({ id: z.string().min(1) });

/**
 * „Antworten“ (eingegangen) und „Folgeschreiben“ (ausgehend): ein Entwurf in der
 * Vorgabeart für ausgehend, im Ordner der Quelle, an den Absender bzw. denselben
 * Empfänger, mit den „betrifft“-Bezügen der Quelle und dem Bezug `repliesTo` —
 * alles in einer Transaktion. Nicht zu verwechseln mit der Wiedervorlage.
 *
 * Ein Empfänger, den der Aufrufer nicht sehen darf (`contacts.view`), wird nicht
 * übernommen: Die Bearbeiten-Seite zeigte ihn nicht und nähme ihn beim Speichern
 * weg, gedruckt stünde er trotzdem im Brief.
 *
 * Liegt die Quelle in einem Schutzbereich und der Entwurf nicht in demselben,
 * trägt der Betreff die Nummer statt des Betreffs, und „betrifft“-Bezüge bleiben
 * zurück — sonst stünde Geschütztes offen in der Akte.
 */
export async function createResponseDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, responseSchema, input);
  if (!parsed.ok) return parsed;

  const source = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!source) return notFound('document', parsed.value.id);
  const unreadable = requireAreaAccess(deps, ctx, source);
  if (unreadable) return unreadable;
  if (source.phase === 'draft') return conflict('documentIsDraft', `Dokument ${source.id} ist noch ein Entwurf`);
  if (source.status === 'voided') return conflict('documentVoided', `Dokument ${source.number ?? source.id} ist storniert`);

  const docType = documentTypeFor(deps.db, defaultTypeKey(deps, 'outgoing'));
  if (!docType) return notFound('documentType', defaultTypeKey(deps, 'outgoing'));
  const owned = refuseModuleOwned(docType);
  if (owned) return owned;
  const targetUnreadable = requireAreaAccess(deps, ctx, { typeKey: docType.key });
  if (targetUnreadable) return targetUnreadable;

  const sourceType = documentTypeFor(deps.db, source.typeKey);
  const crossesArea = isProtectedType(sourceType) && sourceType?.protectionArea !== docType.protectionArea;

  const sourceLinks = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, source.id)).all();
  const addressee = sourceLinks.find((l) => l.entityType === 'contact' && l.role === (source.direction === 'incoming' ? 'sender' : 'recipient'));
  const reserved = reservedLinkTypes(deps);
  const links: DraftValues['links'] = [
    ...(addressee && hasPermission(ctx, 'contacts.view') ? [{ entityType: 'contact', entityId: addressee.entityId, role: 'recipient' as const }] : []),
    ...(crossesArea ? [] : sourceLinks.filter((l) => l.role === 'about' && !reserved.has(l.entityType)).map((l) => ({ entityType: l.entityType, entityId: l.entityId, role: 'about' as const }))),
  ];

  const subject = responseSubject(deps, source.direction, source.documentDate, crossesArea ? (source.number ?? source.id) : source.subject);
  const now = isoNow(deps.clock);
  const id = newId();

  return deps.db.transaction((tx: DbOrTx) => {
    const row = insertDraft(tx, deps, ctx, { id, docType, subject, body: '', documentDate: todayIn(deps), folder: source.folder, links, now });
    insertRelation(tx, deps, ctx, { documentId: row.id, relatedDocumentId: source.id, kind: 'repliesTo' }, row, source);
    return ok(toRecord(deps, ctx, row, tx));
  });
}
