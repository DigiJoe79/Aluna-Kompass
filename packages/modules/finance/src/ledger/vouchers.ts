import { isoNow, newId, notFound, ok, readSetting, requireHumanChannel, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { abortReceive, getDocumentRecord, linkDocumentInternal, listDocuments, readLinkedDocument, receiveGeneratedUpload, type DocumentRecord } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeEntryDocuments, financeFiscalYears } from '../schema';
import { requireFinanceRead } from './access';
import { entryViewInternal } from './entries';
import { fiscalYearStatusInternal } from './fiscal-years';

export interface VoucherLinkResult {
  linkId: string;
  documentId: string;
  documentNumber: string;
}

const uploadVoucherSchema = z.object({
  entryId: z.string().min(1),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'invalidBytes' }),
  typeKey: z.string().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  documentDate: z.string().date(),
});

/**
 * Beleg im Namen der Buchung ablegen — die Buchhalterin braucht kein Recht der
 * Akte. Erlaubt an jeder Buchung, auch festgeschrieben und im abgeschlossenen
 * Jahr: Einen Beleg nachzureichen ist immer erlaubt (Spec 5.2). Der Titel nennt
 * keine Person (Regel für den Aufrufer) und steht nicht im Protokoll.
 */
export async function uploadVoucher(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VoucherLinkResult>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, uploadVoucherSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const entry = entryViewInternal(deps.db, v.entryId);
  if (!entry) return notFound('financeEntry', v.entryId);

  const allowedTypes = readSetting<string[]>(deps, 'finance.voucherTypes');
  if (!allowedTypes.includes(v.typeKey)) return financeConflict('voucherTypeNotAllowed', { type: v.typeKey });

  const subject = v.title ?? `Beleg vom ${v.documentDate}`;
  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: v.typeKey,
    subject,
    documentDate: v.documentDate,
    links: [{ entityType: 'financeEntry', entityId: v.entryId }],
    afterReceive: (tx, doc) => {
      // Zwischen der Prüfung oben und hier vergeht Zeit — die Buchung könnte inzwischen verschwunden sein.
      if (!entryViewInternal(tx, v.entryId)) abortReceive(notFound('financeEntry', v.entryId));
      return writeVoucherLink(tx, deps, ctx, { entryId: v.entryId, documentId: doc.id, documentNumber: doc.number, documentChecksum: doc.fileChecksum, viaUpload: true });
    },
  });
  if (!result.ok) return result;
  return ok(result.value.after!);
}

const attachDocumentSchema = z.object({ entryId: z.string().min(1), documentId: z.string().min(1) });

/**
 * Ein Dokument aus dem Bestand als Beleg verknüpfen — nur ein festgeschriebenes,
 * nicht storniertes, für den Aufrufer lesbares Dokument. Ohne die Leseprüfung
 * könnte man sich über eine Buchung Zugang zu fremden Dokumenten verschaffen.
 */
export async function attachDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VoucherLinkResult>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, attachDocumentSchema, input);
  if (!parsed.ok) return parsed;
  const { entryId, documentId } = parsed.value;

  const entry = entryViewInternal(deps.db, entryId);
  if (!entry) return notFound('financeEntry', entryId);

  const record = await getDocumentRecord(deps, ctx, documentId);
  if (!record.ok) return record;
  const doc = record.value;
  if (doc.phase !== 'issued') return financeConflict('documentNotFinal');
  if (doc.status === 'voided') return financeConflict('documentVoided');

  const already = deps.db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.entryId, entryId), eq(financeEntryDocuments.documentId, documentId))).get();
  if (already) return financeConflict('voucherAlreadyLinked');

  return deps.db.transaction((tx: DbOrTx) => {
    const written = writeVoucherLink(tx, deps, ctx, { entryId, documentId: doc.id, documentNumber: doc.number ?? '', documentChecksum: doc.fileChecksum, viaUpload: false });
    linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeEntry', entityId: entryId });
    return ok(written);
  });
}

const revokeVoucherSchema = z.object({ linkId: z.string().min(1), note: z.string().trim().min(1).max(500), replacementDocumentId: z.string().min(1).optional() });

/**
 * Beleg widerrufen — im offenen Jahr sofort, im abgeschlossenen nur als
 * Ersetzen: Beide Zeilen zeigen dann aufeinander. Der Bezug in `document_links`
 * bleibt auch nach dem Widerruf, der Prüfer muss sehen können, was widerrufen
 * wurde. `finance.entriesFinalize`, **`humanOnly`**.
 */
export async function revokeVoucher(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ linkId: string; replacementLinkId: string | null }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, revokeVoucherSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const link = deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.id, v.linkId)).get();
  if (!link) return notFound('financeEntryDocument', v.linkId);
  if (link.revokedAt !== null) return financeConflict('voucherAlreadyRevoked');

  const entry = entryViewInternal(deps.db, link.entryId);
  if (!entry) return notFound('financeEntry', link.entryId);
  const closed = entry.fiscalYearId !== null && fiscalYearStatusInternal(deps.db, entry.fiscalYearId) === 'closed';
  if (closed && !v.replacementDocumentId) {
    const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, entry.fiscalYearId!)).get()!;
    return financeConflict('revokeNeedsReplacement', { year: year.designation });
  }

  let replacementDoc: { id: string; number: string | null; fileChecksum: string | null } | null = null;
  if (v.replacementDocumentId) {
    const record = await getDocumentRecord(deps, ctx, v.replacementDocumentId);
    if (!record.ok) return record;
    const doc = record.value;
    if (doc.phase !== 'issued') return financeConflict('documentNotFinal');
    if (doc.status === 'voided') return financeConflict('documentVoided');
    const already = deps.db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.entryId, link.entryId), eq(financeEntryDocuments.documentId, doc.id))).get();
    if (already) return financeConflict('voucherAlreadyLinked');
    replacementDoc = { id: doc.id, number: doc.number, fileChecksum: doc.fileChecksum };
  }

  return deps.db.transaction((tx: DbOrTx) => {
    let replacementLinkId: string | null = null;
    if (replacementDoc) {
      const written = writeVoucherLink(tx, deps, ctx, { entryId: link.entryId, documentId: replacementDoc.id, documentNumber: replacementDoc.number ?? '', documentChecksum: replacementDoc.fileChecksum, viaUpload: false });
      linkDocumentInternal(tx, deps, { documentId: replacementDoc.id, entityType: 'financeEntry', entityId: link.entryId });
      replacementLinkId = written.linkId;
    }
    const now = isoNow(deps.clock);
    tx.update(financeEntryDocuments).set({ revokedAt: now, revokedByUserId: ctx.userId, revokeNote: v.note, replacedByLinkId: replacementLinkId }).where(eq(financeEntryDocuments.id, v.linkId)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.entry.documentRevoke', entity: 'financeEntryDocument', id: v.linkId, after: { entryId: link.entryId, documentId: link.documentId, withReplacement: replacementLinkId !== null }, summary: `Beleg an Buchung ${link.entryId} widerrufen` });
    return ok({ linkId: v.linkId, replacementLinkId });
  });
}

const readVoucherSchema = z.object({ entryId: z.string().min(1), documentId: z.string().min(1) });

/**
 * Der Beleg selbst — über den Bezug als Berechtigung der Akte (`readLinkedDocument`):
 * `finance.read` genügt, ohne `dms.view`. Bytes: kein MCP-Werkzeug.
 */
export async function readVoucher(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; number: string | null }>> {
  const parsed = validate(deps, readVoucherSchema, input);
  if (!parsed.ok) return parsed;
  const result = await readLinkedDocument(deps, ctx, { documentId: parsed.value.documentId, entityType: 'financeEntry', entityId: parsed.value.entryId });
  if (!result.ok) return result;
  return ok({ bytes: result.value.bytes, filename: result.value.filename, number: result.value.record.number });
}

/**
 * Die eigene Zeile — dieselbe für Hochladen und Verknüpfen, in derselben
 * Transaktion wie die Akte. Auch von `corrections.ts` benutzt: Der
 * Zweck-Nachweis einer Einnahmezeile hängt genauso an der Buchung wie ein
 * gewöhnlicher Beleg.
 */
export function writeVoucherLink(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { entryId: string; documentId: string; documentNumber: string; documentChecksum: string | null; viaUpload: boolean }): VoucherLinkResult {
  const linkId = newId();
  const now = isoNow(deps.clock);
  tx.insert(financeEntryDocuments)
    .values({
      id: linkId, entryId: input.entryId, documentId: input.documentId, documentNumber: input.documentNumber, documentChecksum: input.documentChecksum, documentDeletedAt: null,
      addedAt: now, addedByUserId: ctx.userId ?? 'system', revokedAt: null, revokedByUserId: null, revokeNote: null, replacedByLinkId: null,
    })
    .run();
  financeAudit(tx, deps, ctx, { action: 'finance.entry.documentAdd', entity: 'financeEntryDocument', id: linkId, after: { entryId: input.entryId, documentId: input.documentId, viaUpload: input.viaUpload }, summary: `Beleg an Buchung ${input.entryId} abgelegt` });
  return { linkId, documentId: input.documentId, documentNumber: input.documentNumber };
}

export interface VoucherWithoutEntry {
  id: string;
  number: string | null;
  subject: string;
  documentDate: string;
  typeKey: string;
}

const listWithoutEntrySchema = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/** Die Seitengröße, mit der die Akte gelesen wird — ihr Höchstwert. */
const DMS_PAGE = 200;

/**
 * Alle festgeschriebenen, nicht widerrufenen Dokumente einer Art — über
 * `listDocuments`, damit die Akte prüft, was der Aufrufer lesen darf
 * (Prinzip 6). Eine Art ohne Leserecht liefert schlicht nichts.
 */
async function issuedDocumentsOfType(deps: Deps, ctx: CallContext, typeKey: string): Promise<Result<DocumentRecord[]>> {
  const all: DocumentRecord[] = [];
  for (let offset = 0; ; offset += DMS_PAGE) {
    const page = await listDocuments(deps, ctx, { typeKey, phase: 'issued', limit: DMS_PAGE, offset });
    if (!page.ok) return page;
    all.push(...page.value.documents.filter((d) => d.status !== 'voided'));
    if (offset + DMS_PAGE >= page.value.total) break;
  }
  return ok(all);
}

/**
 * `finance.read` (F5, Beleg von beiden Seiten): Finanzbelege ohne Buchung —
 * Dokumente der Arten aus `finance.voucherTypes`, festgeschrieben und nicht
 * widerrufen, ohne Bezug `financeEntry`. Die jüngsten zuerst. Was der
 * Aufrufer in der Akte nicht lesen darf, fehlt (die Akte prüft).
 */
export async function listVouchersWithoutEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documents: VoucherWithoutEntry[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listWithoutEntrySchema, input ?? {});
  if (!parsed.ok) return parsed;
  const found: DocumentRecord[] = [];
  for (const typeKey of readSetting<string[]>(deps, 'finance.voucherTypes')) {
    const docs = await issuedDocumentsOfType(deps, ctx, typeKey);
    if (!docs.ok) return docs;
    found.push(...docs.value.filter((d) => !d.links.some((l) => l.entityType === 'financeEntry')));
  }
  found.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.number ?? '').localeCompare(a.number ?? ''));
  const { limit, offset } = parsed.value;
  return ok({
    documents: found.slice(offset, offset + limit).map((d) => ({ id: d.id, number: d.number, subject: d.subject, documentDate: d.documentDate, typeKey: d.typeKey })),
    total: found.length,
  });
}
