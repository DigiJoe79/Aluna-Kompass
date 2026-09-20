import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import {
  blockingHolds,
  conflict,
  deleteFollowUpsFor,
  findModuleRecordReferences,
  invalid,
  isoNow,
  linkedAccess,
  newId,
  notFound,
  notifyRecordDeleted,
  ok,
  parseFolderPath,
  recordAudit,
  requirePermission,
  reservedLinkTypes,
  retentionEnd,
  retentionMonths,
  schema,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Failure,
  type FollowUpRecord,
  type Result,
} from '@kompass/core';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { refuseModuleOwned } from './owned';
import { documentCounters, documentFolders, documentFormerNumbers, documentLinks, documentRelations, documents, documentTypes, type DocumentLinkRow, type DocumentNoteRow, type DocumentRow } from './schema';
import { checksumOf, readDocumentFile, removeDocumentFile } from './storage';
import { removeDocumentText } from './index-store';
import { fulltextCondition, fulltextHits, type TextHit } from './search';
import { deleteNotesFor, notesFor } from './notes';
import { deleteRelationsFor, relationsFor, type DocumentRelationView } from './relations';

/** Der Zustand der Datei eines Dokuments, ohne sie auszuliefern. */
export type DocumentFileState = 'ok' | 'altered' | 'missing' | 'none';

export type DocumentRecord = Omit<DocumentRow, 'inputSnapshot'> & {
  inputSnapshot: unknown;
  links: DocumentLinkRow[];
  relations: DocumentRelationView[];
  notes: DocumentNoteRow[];
  followUps: FollowUpRecord[];
  /** Nummern vor einem Umklassifizieren, die älteste zuerst (Spec 2026-09-19). */
  formerNumbers: string[];
  /**
   * Ob die Datei noch zur Prüfsumme passt. Nur `getDocumentRecord` füllt das —
   * eine Liste kann es nicht, ohne jede Datei zu lesen; dort steht `undefined`.
   */
  fileState?: DocumentFileState;
};

export function toRecord(deps: Deps, row: DocumentRow, dbOrTx: DbOrTx = deps.db): DocumentRecord {
  const links = dbOrTx.select().from(documentLinks).where(eq(documentLinks.documentId, row.id)).all();
  return {
    ...row,
    inputSnapshot: row.inputSnapshot ? JSON.parse(row.inputSnapshot) : null,
    links,
    relations: relationsFor(dbOrTx, row.id),
    notes: notesFor(dbOrTx, row.id),
    formerNumbers: dbOrTx
      .select({ number: documentFormerNumbers.number })
      .from(documentFormerNumbers)
      .where(eq(documentFormerNumbers.documentId, row.id))
      .orderBy(asc(documentFormerNumbers.replacedAt), sql`rowid`)
      .all()
      .map((r) => r.number),
    // Direkt gelesen, ohne Rechteprüfung: Die Akte liest ihre eigenen
    // Anhängsel — wer das Dokument sehen darf, sieht seine Wiedervorlagen.
    followUps: dbOrTx
      .select()
      .from(schema.followUps)
      .where(and(eq(schema.followUps.entityType, 'document'), eq(schema.followUps.entityId, row.id)))
      .orderBy(asc(schema.followUps.dueAt))
      .all()
      .map((f) => ({ ...f, titleHidden: false })),
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

  const owned = refuseModuleOwned(docType);
  if (owned) return owned;

  const year = deps.clock.now().getUTCFullYear();
  return ok({ number: peekDocumentNumber(deps.db, docType.prefix, year) });
}

export const documentListSchema = z.object({
  direction: z.enum(['outgoing', 'incoming']).optional(),
  phase: z.enum(['draft', 'issued']).optional(),
  typeKey: z.string().min(1).optional(),
  folder: z.string().nullable().optional(), // null = ohne Ordner
  inbox: z.boolean().optional(),
  linkedTo: z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }).optional(),
  text: z.string().trim().min(1).optional(), // Betreff oder Nummer
  orderBy: z
    .object({
      field: z.enum(['number', 'subject', 'documentDate', 'typeKey', 'folder', 'createdAt']),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  /** Ausgehend, festgeschrieben, ohne Versandvermerk. */
  unsent: z.boolean().optional(),
  /** Dokumente, die mit diesem in einem Bezug stehen — in beiden Richtungen. */
  relatedTo: z.string().min(1).optional(),
  /** Nur Dokumente mit mindestens einer offenen Wiedervorlage. */
  withOpenFollowUp: z.boolean().optional(),
  /** Nur Dokumente dieses Verfassers — die Kachel „Entwürfe“ mit „nur meine“. */
  createdByUserId: z.string().min(1).optional(),
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
  // Der Eingangskorb ist Post, die noch nicht einsortiert ist — nicht alles
  // ohne Ordner. Ein Brief ohne Ordner ist ein Brief ohne Ordner (Nachtrag zu
  // Entscheidung 20).
  if (q.inbox) conditions.push(eq(documents.direction, 'incoming'), sql`${documents.folder} is null`);
  else if (q.folder !== undefined) conditions.push(q.folder === null ? sql`${documents.folder} is null` : eq(documents.folder, q.folder));

  let fulltextTooShort = false;
  if (q.text) {
    const inFulltext = fulltextCondition(q.text);
    fulltextTooShort = inFulltext === null;
    // Auch frühere Nummern: Wer eine Nummer vor dem Umklassifizieren notiert
    // hat, soll trotzdem beim Dokument landen (Spec 2026-09-19).
    const byFormerNumber = sql`${documents.id} IN (SELECT document_id FROM document_former_numbers WHERE number LIKE ${`%${q.text}%`})`;
    const byText = or(like(documents.subject, `%${q.text}%`), like(documents.number, `%${q.text}%`), byFormerNumber);
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
  if (q.unsent) {
    conditions.push(eq(documents.direction, 'outgoing'), eq(documents.phase, 'issued'), sql`${documents.sentAt} is null`);
    // Was ein Modul ausstellt, verschickt es nach eigenen Regeln (Serienlauf, Bericht) — es stünde hier ewig.
    conditions.push(inArray(documents.typeKey, deps.db.select({ key: documentTypes.key }).from(documentTypes).where(isNull(documentTypes.ownerModule))));
  }
  if (q.relatedTo) {
    const ids = new Set<string>();
    for (const r of deps.db.select().from(documentRelations).where(eq(documentRelations.documentId, q.relatedTo)).all()) ids.add(r.relatedDocumentId);
    for (const r of deps.db.select().from(documentRelations).where(eq(documentRelations.relatedDocumentId, q.relatedTo)).all()) ids.add(r.documentId);
    conditions.push(inArray(documents.id, ids.size > 0 ? [...ids] : ['__none__']));
  }

  if (q.withOpenFollowUp) {
    conditions.push(sql`${documents.id} IN (SELECT entity_id FROM follow_ups WHERE entity_type = 'document' AND done_at IS NULL)`);
  }

  if (q.createdByUserId) conditions.push(eq(documents.createdByUserId, q.createdByUserId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;

  const columns = { number: documents.number, subject: documents.subject, documentDate: documents.documentDate, typeKey: documents.typeKey, folder: documents.folder, createdAt: documents.createdAt } as const;
  // Ohne Parameter bleibt es chronologisch (Entscheidung 31); mit Parameter
  // bricht die Nummer Gleichstände, damit die Reihenfolge stabil bleibt.
  const order = q.orderBy
    ? [q.orderBy.direction === 'asc' ? asc(columns[q.orderBy.field]) : desc(columns[q.orderBy.field]), desc(documents.number)]
    : [desc(documents.createdAt), desc(documents.number)];
  const rows = deps.db.select().from(documents).where(where).orderBy(...order).limit(q.limit).offset(q.offset).all();

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

/**
 * Ein Dokument mit allem, was dazugehört — **einschließlich der Frage, ob
 * seine Datei noch die festgeschriebene ist**.
 *
 * Der Zustand steht bewusst im Datensatz und nicht in einer eigenen Funktion:
 * Sonst wüsste die Detailseite Bescheid und ein Agent über `dms_get` nicht.
 * Wer über MCP fragt, ob ein Dokument vorliegt, soll dieselbe Antwort
 * bekommen wie der Mensch vor dem Bildschirm.
 *
 * Nur hier, nicht in `listDocuments`: Für eine Liste müsste jede Datei
 * gelesen werden, und die Liste soll schnell bleiben.
 */
export async function getDocumentRecord(deps: Deps, ctx: CallContext, id: string): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  const fileState: DocumentFileState = row.fileName ? (await pruefeDatei(deps, ctx, row)).state : 'none';
  return ok({ ...toRecord(deps, row), fileState });
}

/**
 * Liest die Datei und hält sie gegen die gespeicherte Prüfsumme.
 *
 * Der Befund kommt ins Änderungsprotokoll — aber **einmal je Dokument und
 * Ist-Summe**, nicht bei jedem Blick. Beim Nachstellen am 2026-09-15 standen
 * nach einem einzigen Seitenaufruf drei Einträge da: Die Seite fragt den
 * Zustand ab, der `<iframe>` holt die Datei, und jeder Neuaufbau zählte
 * erneut. Das Protokoll soll den Befund festhalten, nicht die Zahl der Blicke
 * darauf. Ändert sich die Datei ein zweites Mal, ist das ein neuer Befund und
 * bekommt seinen Eintrag.
 */
async function pruefeDatei(
  deps: Deps,
  ctx: CallContext,
  row: typeof documents.$inferSelect,
): Promise<{ state: DocumentFileState; bytes?: Uint8Array; actual?: string }> {
  let bytes: Uint8Array;
  try {
    bytes = await readDocumentFile(deps, row.fileName!);
  } catch {
    // Eine Datei, die gar nicht mehr da ist, ist kein Fälschungsverdacht.
    return { state: 'missing' };
  }
  if (!row.fileChecksum) return { state: 'ok', bytes };

  const actual = checksumOf(bytes);
  if (actual === row.fileChecksum) return { state: 'ok', bytes };

  const schonVermerkt = deps.db
    .select()
    .from(schema.auditLog)
    .all()
    .some((e) => e.action === 'dms.checksumMismatch' && e.entityId === row.id && typeof e.after === 'string' && e.after.includes(actual));
  if (!schonVermerkt) {
    deps.db.transaction((tx: DbOrTx) => {
      recordAudit(tx, deps, ctx, {
        action: 'dms.checksumMismatch',
        entityType: 'document',
        entityId: row.id,
        before: { checksum: row.fileChecksum },
        after: { expected: row.fileChecksum, actual },
        summary: `Datei von Dokument ${row.number} stimmt nicht mehr mit der Prüfsumme überein`,
      });
    });
  }
  return { state: 'altered', actual };
}

/**
 * Ein Dokument mit seiner Datei — und nur dann, wenn die Datei noch die ist,
 * die festgeschrieben wurde.
 *
 * Die Prüfsumme wurde seit jeher gebildet, gespeichert und in der Akte
 * angezeigt, aber bis zum 2026-09-15 nie nachgerechnet: Wer im Datenvolume
 * eine PDF austauschte, bekam sie weiter ausgeliefert, mit der alten Summe
 * daneben. Eine Prüfsumme, die niemand prüft, sieht aus wie ein Nachweis und
 * ist keiner.
 *
 * Bei Abweichung wird **nicht** ausgeliefert. Das ist die unbequemere Antwort:
 * Der Verein kommt an das Dokument durch die Anwendung nicht mehr heran. Aber
 * ein festgeschriebenes Schreiben, dessen Inhalt sich geändert hat, als
 * unverändert weiterzureichen, wäre die falsche Hilfe — und die Datei liegt
 * weiter im Volume, für den, der sie prüfen muss.
 *
 * Ein Entwurf trägt keine Summe (`fileChecksum: null`): Seine Datei entsteht
 * bei jeder Vorschau neu, das ist seine Natur und kein Vorfall.
 */
export async function getDocument(deps: Deps, ctx: CallContext, id: string): Promise<Result<{ record: DocumentRecord; bytes: Uint8Array; filename: string }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return notFound('document', id);
  if (!row.fileName) return notFound('documentFile', id);

  const geprueft = await pruefeDatei(deps, ctx, row);
  if (geprueft.state === 'missing') return notFound('documentFile', id);
  if (geprueft.state === 'altered') {
    return conflict('documentAltered', `Die Datei von Dokument ${row.number} stimmt nicht mehr mit der beim Festschreiben gebildeten Prüfsumme überein`);
  }

  return ok({ record: toRecord(deps, row), bytes: geprueft.bytes!, filename: `${row.number}.pdf` });
}

const linkedDocumentSchema = z.object({ documentId: z.string().min(1), entityType: z.string().min(1), entityId: z.string().min(1) });

/**
 * Der Bezug als Berechtigung: genau dieses Dokument, für den, der den Vorgang
 * lesen darf — die Helferin ihren Auslagenbeleg, der Kassenprüfer den Beschluss
 * zur Rücklage. Kein Weg in die Akte. Recht **und** Bezug prüft dieser Dienst;
 * dem aufrufenden Modul bleibt nur die Frage, ob der Vorgang dem Aufrufer
 * gehört („eigener Antrag“).
 */
export async function readLinkedDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ record: { id: string; number: string | null; subject: string; typeKey: string; documentDate: string; status: 'issued' | 'voided' }; bytes: Uint8Array; filename: string }>> {
  const parsed = validate(deps, linkedDocumentSchema, input);
  if (!parsed.ok) return parsed;
  const { documentId, entityType, entityId } = parsed.value;
  const unknown = notFound('linkedDocument', documentId);

  const access = linkedAccess(deps, entityType);
  if (!access) return unknown;
  const denied = requirePermission(ctx, access.readPermission);
  if (denied) return denied;

  const link = deps.db.select({ id: documentLinks.id }).from(documentLinks).where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.entityType, entityType), eq(documentLinks.entityId, entityId))).get();
  if (!link) return unknown;
  const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!row || !row.fileName) return unknown;

  const checked = await pruefeDatei(deps, ctx, row);
  if (checked.state === 'missing') return notFound('documentFile', documentId);
  if (checked.state === 'altered') return conflict('documentAltered', `Die Datei von Dokument ${row.number} stimmt nicht mehr mit der beim Festschreiben gebildeten Prüfsumme überein`);
  return ok({ record: { id: row.id, number: row.number, subject: row.subject, typeKey: row.typeKey, documentDate: row.documentDate, status: row.status }, bytes: checked.bytes!, filename: `${row.number}.pdf` });
}

/**
 * Storno in einer fremden Transaktion — für Module, die ihr eigenes Dokument
 * stornieren (Bestätigung, Bericht). Ohne Rechteprüfung und ohne die Sperre für
 * modul-eigene Arten: Beides prüft der Dienst des Moduls. Der Grund steht am
 * Dokument, nicht im Protokoll — er ist frei getippt, und das Protokoll ist
 * unlöschbar.
 */
export function voidDocumentInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { id: string; reason: string }): Result<{ id: string; number: string | null }> {
  const row = tx.select().from(documents).where(eq(documents.id, input.id)).get();
  if (!row) return notFound('document', input.id);
  if (row.phase !== 'issued') return conflict('documentIsDraft', 'Ein Entwurf kann nicht storniert werden — nur verworfen');
  if (row.status === 'voided') return conflict('documentAlreadyVoided', `Dokument ${row.number} ist bereits storniert`);
  tx.update(documents).set({ status: 'voided', voidedAt: isoNow(deps.clock), voidedByUserId: ctx.userId, voidReason: input.reason }).where(eq(documents.id, row.id)).run();
  recordAudit(tx, deps, ctx, { action: 'dms.void', entityType: 'document', entityId: row.id, before: { status: 'issued' }, after: { status: 'voided' }, summary: `Dokument ${row.number} storniert` });
  return ok({ id: row.id, number: row.number });
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

  const docType = documentTypeFor(deps.db, row.typeKey);
  const owned = docType ? refuseModuleOwned(docType) : null;
  if (owned) return owned;
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

/** Bezugstypen, die ein Modul über `linkedDocumentAccess` anmeldet, setzt und löst nur dieses Modul. */
export function refuseReservedLinks(deps: Deps, links: readonly { entityType: string }[]): Failure | null {
  const reserved = reservedLinkTypes(deps);
  const hit = links.find((link) => reserved.has(link.entityType));
  return hit ? conflict('linkTypeReserved', `Bezüge auf „${hit.entityType}“ setzt und löst nur das Modul, dem dieser Vorgang gehört`) : null;
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

  const reservedHit = refuseReservedLinks(deps, [parsed.value]);
  if (reservedHit) return reservedHit;

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

  const reservedHit = refuseReservedLinks(deps, [link]);
  if (reservedHit) return reservedHit;

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

  // Die Frist der Dokumentart ist nur die eigene. Ein Modul kann länger halten
  // (die Buchung ihren Beleg) — und solange eines darauf zeigt, bleibt es.
  // Ein Modul lässt seinen Verweis mit seinem Halter enden; sonst wäre ein
  // Beleg nie löschbar.
  const holds = blockingHolds(deps, 'document', doc.id);
  if (holds.length > 0) return conflict('recordHeld', `Noch gehalten von: ${holds.map((h) => `${h.label}${h.until ? ` (bis ${h.until})` : ' (dauerhaft)'}`).join('; ')}`);
  const references = findModuleRecordReferences(deps, 'document', doc.id);
  if (references.length > 0) return conflict('stillReferenced', `Es zeigt noch darauf: ${references.map((r) => r.label).join('; ')}`);

  deps.db.transaction((tx: DbOrTx) => {
    // Was mit dem Dokument verschwindet, steht im Protokoll — als Zahl, nicht
    // als Inhalt: Arbeitsmaterial geht mit, die Tatsache bleibt.
    const removed = {
      relations: deleteRelationsFor(tx, doc.id),
      notes: deleteNotesFor(tx, doc.id),
      followUps: deleteFollowUpsFor(tx, 'document', doc.id),
    };

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
        removed,
      },
      summary: `Dokument ${doc.number ?? doc.subject} gelöscht`,
    });

    tx.delete(documentLinks).where(eq(documentLinks.documentId, doc.id)).run();
    tx.delete(documentFormerNumbers).where(eq(documentFormerNumbers.documentId, doc.id)).run();
    tx.delete(documents).where(eq(documents.id, doc.id)).run();
    notifyRecordDeleted(tx, deps, ctx, 'document', doc.id);
  });

  removeDocumentText(deps, doc.id);

  // Die Datei gehört diesem Modul, nicht der Mediathek: Kein fremder Dienst,
  // kein fremdes Recht, kein Kontext, dem hier etwas untergeschoben wird.
  if (doc.fileName) await removeDocumentFile(deps, doc.fileName);

  return ok(null);
}


