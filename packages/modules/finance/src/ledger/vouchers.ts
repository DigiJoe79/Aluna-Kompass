import { isoNow, newId, notFound, ok, readSetting, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { abortReceive, getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeEntryDocuments } from '../schema';
import { entryViewInternal } from './entries';

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

/** Die eigene Zeile — dieselbe für Hochladen und Verknüpfen, in derselben Transaktion wie die Akte. */
function writeVoucherLink(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { entryId: string; documentId: string; documentNumber: string; documentChecksum: string | null; viaUpload: boolean }): VoucherLinkResult {
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
