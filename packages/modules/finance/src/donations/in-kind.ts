import { isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { writeVoucherLink } from '../ledger/vouchers';
import { financeAllocationLines, financeCategories, financeEntryDocuments, financeInKindDetails, type FinanceInKindDetailsRow } from '../schema';
import { openConfirmationsForLinesInternal } from './check';

/**
 * Was eine Sachspende ist (F6a Task 5, Prüfstein 5, Annahme 11) — an der
 * `inKindDonation`-Zeile, ohne Geldfluss. Gegenstand, Zustand und
 * Wertermittlung sind Freitext: am Datensatz, nie im Protokoll. Die
 * Wertunterlage ist ein festgeschriebenes Dokument der Akte und hängt als
 * Beleg an der Buchung. Änderbar, solange keine gültige Bestätigung die Zeile
 * trägt.
 */
const text = (max: number) => z.string().trim().min(1).max(max);

const saveSchema = z
  .object({
    lineId: z.string().min(1),
    item: text(500),
    condition: text(500),
    valuation: text(1000),
    origin: z.enum(['private', 'business']),
    withdrawalValueCents: z.number().int().min(0).nullable().optional(),
    vatCents: z.number().int().min(0).nullable().optional(),
    proofDocumentId: z.string().min(1).nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.origin !== 'business') return;
    if (v.withdrawalValueCents == null) c.addIssue({ code: 'custom', path: ['withdrawalValueCents'], message: 'withdrawalValueRequired' });
    if (v.vatCents == null) c.addIssue({ code: 'custom', path: ['vatCents'], message: 'vatRequired' });
  });

const auditFields = (row: FinanceInKindDetailsRow) => ({ lineId: row.lineId, origin: row.origin, withdrawalValueCents: row.withdrawalValueCents, vatCents: row.vatCents, proofDocumentId: row.proofDocumentId });

/** `finance.entriesWrite`: Angaben zur Sachspende anlegen oder ändern; die Wertunterlage wird Beleg der Buchung, falls sie es noch nicht ist. */
export async function saveInKindDetails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinanceInKindDetailsRow>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const line = deps.db.select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, incomeKind: financeCategories.incomeKind }).from(financeAllocationLines).innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id)).where(eq(financeAllocationLines.id, v.lineId)).get();
  if (!line) return notFound('financeAllocationLine', v.lineId);
  if (line.incomeKind !== 'inKindDonation') return financeConflict('inKindLineOnly');
  const confirmed = openConfirmationsForLinesInternal(deps.db, [line.id]).get(line.id);
  if (confirmed) return financeConflict('confirmationLineAlreadyConfirmed', { number: confirmed.number });

  const proofDocumentId = v.proofDocumentId ?? null;
  let proof: { id: string; number: string; fileChecksum: string | null } | null = null;
  if (proofDocumentId) {
    const record = await getDocumentRecord(deps, ctx, proofDocumentId);
    if (!record.ok) return record;
    if (record.value.phase !== 'issued') return financeConflict('documentNotFinal');
    if (record.value.status === 'voided') return financeConflict('documentVoided');
    proof = { id: record.value.id, number: record.value.number ?? '', fileChecksum: record.value.fileChecksum };
  }

  return deps.db.transaction((tx: DbOrTx) => {
    // Zwischen Prüfung und Transaktion könnte eine Bestätigung entstanden sein.
    const fresh = openConfirmationsForLinesInternal(tx, [line.id]).get(line.id);
    if (fresh) return financeConflict('confirmationLineAlreadyConfirmed', { number: fresh.number });
    const now = isoNow(deps.clock);
    const before = tx.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, line.id)).get();
    const fields = { item: v.item, condition: v.condition, valuation: v.valuation, origin: v.origin, withdrawalValueCents: v.origin === 'business' ? (v.withdrawalValueCents ?? null) : null, vatCents: v.origin === 'business' ? (v.vatCents ?? null) : null, proofDocumentId, updatedAt: now };
    if (before) tx.update(financeInKindDetails).set(fields).where(eq(financeInKindDetails.lineId, line.id)).run();
    else tx.insert(financeInKindDetails).values({ lineId: line.id, ...fields, createdAt: now }).run();

    if (proof) {
      const linked = tx.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.entryId, line.entryId), eq(financeEntryDocuments.documentId, proof.id))).get();
      if (!linked) {
        writeVoucherLink(tx, deps, ctx, { entryId: line.entryId, documentId: proof.id, documentNumber: proof.number, documentChecksum: proof.fileChecksum, viaUpload: false });
        linkDocumentInternal(tx, deps, { documentId: proof.id, entityType: 'financeEntry', entityId: line.entryId });
      }
    }

    const after = tx.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, line.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.inKindDetails.save', entity: 'financeInKindDetails', id: line.id, before: before ? auditFields(before) : undefined, after: auditFields(after), summary: `Angaben zur Sachspende an Zeile ${line.id} ${before ? 'geändert' : 'erfasst'}` });
    return ok(after);
  });
}

const getSchema = z.object({ lineId: z.string().min(1) });

/** `finance.read`: die Angaben zur Sachspende einer Zeile, oder `null`. */
export async function getInKindDetails(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinanceInKindDetailsRow | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  return ok(deps.db.select().from(financeInKindDetails).where(eq(financeInKindDetails.lineId, parsed.value.lineId)).get() ?? null);
}
