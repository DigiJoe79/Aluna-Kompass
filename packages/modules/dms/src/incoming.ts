import {
  conflict,
  expectedVersionField,
  invalid,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
  retentionEnd,
  retentionMonths,
  staleVersion,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { refuseModuleOwned } from './owned';
import { RELATION_KINDS, documentFormerNumbers, documentLinks, documentRelations, documents, type DocumentRow, type DocumentTypeRow } from './schema';
import { removeDocumentFile, storeDocumentFile } from './storage';
import { allocateDocumentNumber, linkInputSchema, peekDocumentNumber, refuseReservedLinks, resolveFolder, toRecord, type DocumentRecord } from './service';

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

  const reservedHit = refuseReservedLinks(deps, parsed.value.links);
  if (reservedHit) return reservedHit;

  const docType = documentTypeFor(deps.db, parsed.value.typeKey);
  if (!docType) return notFound('documentType', parsed.value.typeKey);

  const owned = refuseModuleOwned(docType);
  if (owned) return owned;

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

/**
 * Eingang umklassifizieren (Spec 2026-09-19): Art, Betreff und Datum eines
 * abgelegten eingehenden Dokuments nachträglich ändern. Die Datei bleibt, wie
 * sie ist. Wechselt die Art, zieht das Dokument eine neue Nummer aus deren
 * Präfix, im Jahr seiner Ablage; die alte bleibt in `document_former_numbers`
 * vermerkt. Ausgehende Dokumente bleiben unveränderlich — ihre Nummer steht im
 * verschickten PDF.
 */
export const reclassifySchema = z.object({
  id: z.string().min(1),
  typeKey: z.string().min(1).optional(),
  subject: receiveFields.subject.optional(),
  documentDate: receiveFields.documentDate.optional(),
  /** Ladestand (`updatedAt`); veraltet → `staleVersion` (Backlog 20). */
  expectedVersion: expectedVersionField,
});

/** Das Jahr der Ablage — daraus kam die erste Nummer, daraus kommt jede weitere. */
const filingYear = (row: DocumentRow) => Number(row.createdAt.slice(0, 4));

function loadIncoming(deps: Deps, id: string): Result<DocumentRow> {
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  if (row.direction !== 'incoming') return conflict('notIncoming', `Dokument ${row.number ?? row.id} ist ausgehend; seine Nummer steht im verschickten PDF`);
  if (row.status === 'voided') return conflict('documentVoided', `Dokument ${row.number ?? row.id} ist storniert`);
  const own = documentTypeFor(deps.db, row.typeKey);
  const owned = own ? refuseModuleOwned(own) : null;
  if (owned) return owned;
  return ok(row);
}

function targetType(deps: Deps, key: string): Result<DocumentTypeRow> {
  const docType = documentTypeFor(deps.db, key);
  if (!docType) return notFound('documentType', key);
  if (!docType.isActive) return conflict('documentTypeInactive', `Dokumentart „${docType.label}“ ist abgeschaltet`);
  const owned = refuseModuleOwned(docType);
  if (owned) return owned;
  return ok(docType);
}

export async function reclassifyDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, reclassifySchema, input);
  if (!parsed.ok) return parsed;
  const { id, typeKey, subject, documentDate, expectedVersion } = parsed.value;

  const loaded = loadIncoming(deps, id);
  if (!loaded.ok) return loaded;
  const before = loaded.value;
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;

  let newType: DocumentTypeRow | null = null;
  if (typeKey !== undefined && typeKey !== before.typeKey) {
    const found = targetType(deps, typeKey);
    if (!found.ok) return found;
    newType = found.value;
  }
  const nextSubject = subject !== undefined && subject !== before.subject ? subject : null;
  const nextDate = documentDate !== undefined && documentDate !== before.documentDate ? documentDate : null;
  // Nichts geändert: kein Fehler, aber auch kein Eintrag im Protokoll.
  if (!newType && nextSubject === null && nextDate === null) return ok(toRecord(deps, before));

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    let number = before.number;
    if (newType && before.number) {
      tx.insert(documentFormerNumbers).values({ documentId: id, number: before.number, replacedAt: now }).run();
      number = allocateDocumentNumber(tx, newType.prefix, filingYear(before));
    }
    tx.update(documents)
      .set({
        typeKey: newType?.key ?? before.typeKey,
        number,
        subject: nextSubject ?? before.subject,
        documentDate: nextDate ?? before.documentDate,
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .run();
    const after = tx.select().from(documents).where(eq(documents.id, id)).get()!;
    const pick = (row: DocumentRow) => ({ typeKey: row.typeKey, number: row.number, subject: row.subject, documentDate: row.documentDate });
    recordAudit(tx, deps, ctx, {
      action: 'dms.reclassify',
      entityType: 'document',
      entityId: id,
      before: pick(before),
      after: pick(after),
      summary: newType ? `${before.number} → ${after.number} umklassifiziert` : `Angaben zu ${after.number} berichtigt`,
    });
    return ok(toRecord(deps, after, tx));
  });
}

export const reclassifyPreviewSchema = z.object({
  id: z.string().min(1),
  typeKey: z.string().min(1),
  documentDate: receiveFields.documentDate,
});

export interface RetentionView {
  retentionClass: DocumentTypeRow['retentionClass'];
  /** Letzter Tag der Aufbewahrung; `null` bei dauerhafter oder nicht eingestellter Frist. */
  until: string | null;
}

export interface ReclassificationPreview {
  number: { current: string | null; next: string | null };
  retention: { current: RetentionView; next: RetentionView };
}

function retentionOf(deps: Deps, docType: DocumentTypeRow, documentDate: string): RetentionView {
  if (docType.retentionClass === 'permanent') return { retentionClass: docType.retentionClass, until: null };
  const months = retentionMonths(deps, docType.retentionClass);
  return { retentionClass: docType.retentionClass, until: months === null ? null : retentionEnd(documentDate, months) };
}

/**
 * Was ein Umklassifizieren bewirken würde — für den Dialog, bevor jemand
 * bestätigt. Liest nur. Die Nummer ist ein Blick wie bei `previewNextNumber`:
 * Gezogen wird sie erst beim Speichern.
 */
export async function previewReclassification(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReclassificationPreview>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, reclassifyPreviewSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadIncoming(deps, parsed.value.id);
  if (!loaded.ok) return loaded;
  const row = loaded.value;
  const currentType = documentTypeFor(deps.db, row.typeKey);
  if (!currentType) return notFound('documentType', row.typeKey);
  const changes = parsed.value.typeKey !== row.typeKey;
  const found = changes ? targetType(deps, parsed.value.typeKey) : ok(currentType);
  if (!found.ok) return found;
  return ok({
    number: { current: row.number, next: changes ? peekDocumentNumber(deps.db, found.value.prefix, filingYear(row)) : null },
    retention: { current: retentionOf(deps, currentType, row.documentDate), next: retentionOf(deps, found.value, parsed.value.documentDate) },
  });
}
