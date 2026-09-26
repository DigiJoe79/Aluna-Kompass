import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { ENTRY_LOCKS, type EntryLock } from '../locks';
import { financeAllocationCorrections, financeAllocationLines, financeCategories, financeFiscalYears, financePurposes, type FinanceAllocationCorrectionRow } from '../schema';
import { requireFinanceRead } from './access';
import { CERTIFIABLE_INCOME_KINDS } from './codes';
import { entryViewInternal } from './entries';
import { fiscalYearStatusInternal } from './fiscal-years';
import { writeVoucherLink } from './vouchers';

export type CorrectionView = FinanceAllocationCorrectionRow;

/** Vorher-/Nachher-Felder einer Zuordnungszeile, die eine Korrektur ändern darf — genau die vier, die die F2a-Trigger einer festgeschriebenen Zeile durchlassen. */
interface LineFields {
  contactId: string | null;
  projectId: string | null;
  purposeId: string | null;
  abroad: boolean;
}

class CorrectionAborted extends Error {
  constructor(readonly failure: Failure) {
    super('correction aborted');
    this.name = 'CorrectionAborted';
  }
}
function abortCorrection(failure: Failure): never {
  throw new CorrectionAborted(failure);
}

function contactExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
}
function projectExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}
function purposeExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, id)).get();
}

function correctionViewOf(db: DbOrTx, id: string): CorrectionView {
  return db.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.id, id)).get()!;
}

/** Welche der vier Felder der Antrag überhaupt nennt — für Protokoll und Anwenden gleichermaßen. */
function changedFlags(correction: Pick<FinanceAllocationCorrectionRow, 'after'>) {
  const after = JSON.parse(correction.after) as Partial<LineFields>;
  return { partyChanged: 'contactId' in after, projectChanged: 'projectId' in after, purposeChanged: 'purposeId' in after, abroadChanged: 'abroad' in after };
}

function auditFieldsFor(correction: FinanceAllocationCorrectionRow, state: CorrectionView['state']): Record<string, unknown> {
  const flags = changedFlags(correction);
  return { entryId: correction.entryId, lineId: correction.lineId, state, ...flags, withProof: correction.proofDocumentId !== null, section153: correction.section153 };
}

/**
 * Die Zeile in einer bereits offenen Transaktion tatsächlich ändern — nur die
 * genannten der vier Spalten, mehr lassen die F2a-Trigger einer
 * festgeschriebenen Zeile nicht durch. Die Kontakt-Sperre wird hier erneut
 * geprüft, mit austauschbaren `locks` für den Test (Muster `reverseInternal`).
 */
export function applyCorrectionInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, correctionId: string, locks: readonly EntryLock[] = ENTRY_LOCKS): Result<CorrectionView> {
  const correction = tx.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.id, correctionId)).get();
  if (!correction) return notFound('financeAllocationCorrection', correctionId);
  if (correction.state !== 'pending') return financeConflict('correctionNotPending');

  const after = JSON.parse(correction.after) as Partial<LineFields>;
  if ('contactId' in after) {
    for (const lock of locks) {
      const hit = lock(tx, correction.entryId);
      if (hit && hit.scope === 'contact') return financeConflict('contactLocked', { reason: hit.reason });
    }
  }

  const set: Partial<LineFields> = {};
  if ('contactId' in after) set.contactId = after.contactId ?? null;
  if ('projectId' in after) set.projectId = after.projectId ?? null;
  if ('purposeId' in after) set.purposeId = after.purposeId ?? null;
  if ('abroad' in after) set.abroad = after.abroad ?? false;
  tx.update(financeAllocationLines).set(set).where(eq(financeAllocationLines.id, correction.lineId)).run();

  const now = isoNow(deps.clock);
  tx.update(financeAllocationCorrections).set({ state: 'applied', approvedByUserId: ctx.userId, approvedAt: now }).where(eq(financeAllocationCorrections.id, correctionId)).run();
  const applied = correctionViewOf(tx, correctionId);
  financeAudit(tx, deps, ctx, { action: 'finance.correction.apply', entity: 'financeAllocationCorrection', id: correctionId, after: auditFieldsFor(applied, 'applied'), summary: `Zuordnungskorrektur ${correctionId} angewandt` });
  return ok(applied);
}

const changesSchema = z.object({
  contactId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  abroad: z.boolean().optional(),
});

const requestSchema = z.object({
  lineId: z.string().min(1),
  changes: changesSchema,
  note: z.string().trim().min(1).max(500),
  proofDocumentId: z.string().min(1).optional(),
  acknowledgeSection153: z.boolean().optional(),
});

/**
 * `finance.entriesFinalize`, **`humanOnly`**. Im offenen Jahr sofort wirksam;
 * im abgeschlossenen wartet sie auf die Freigabe einer zweiten Person (Spec
 * 5.4, E18).
 */
export async function requestAllocationCorrection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ correction: CorrectionView; applied: boolean; notices: ('section153')[] }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, requestSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const line = deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.id, v.lineId)).get();
  if (!line) return notFound('financeAllocationLine', v.lineId);
  const entry = entryViewInternal(deps.db, line.entryId);
  if (!entry) return notFound('financeEntry', line.entryId);
  if (entry.status !== 'final') return financeConflict('lineNotFinal');

  if (v.changes.contactId && !contactExists(deps.db, v.changes.contactId)) return notFound('contact', v.changes.contactId);
  if (v.changes.projectId && !projectExists(deps.db, v.changes.projectId)) return notFound('project', v.changes.projectId);
  if (v.changes.purposeId && !purposeExists(deps.db, v.changes.purposeId)) return notFound('financePurpose', v.changes.purposeId);

  const changed: Partial<LineFields> = {};
  if ('contactId' in v.changes && v.changes.contactId !== line.contactId) changed.contactId = v.changes.contactId ?? null;
  if ('projectId' in v.changes && v.changes.projectId !== line.projectId) changed.projectId = v.changes.projectId ?? null;
  if ('purposeId' in v.changes && v.changes.purposeId !== line.purposeId) changed.purposeId = v.changes.purposeId ?? null;
  if ('abroad' in v.changes && v.changes.abroad !== line.abroad) changed.abroad = v.changes.abroad;
  if (Object.keys(changed).length === 0) return financeConflict('correctionChangesNothing');

  const isIncomeLine = line.amountCents > 0;
  const purposeChanges = 'purposeId' in changed;
  let proofDoc: { id: string; number: string | null; fileChecksum: string | null } | null = null;
  if (isIncomeLine && purposeChanges) {
    if (!v.proofDocumentId) return financeConflict('purposeChangeNeedsProof');
    const record = await getDocumentRecord(deps, ctx, v.proofDocumentId);
    if (!record.ok) return record;
    if (record.value.phase !== 'issued') return financeConflict('documentNotFinal');
    if (record.value.status === 'voided') return financeConflict('documentVoided');
    proofDoc = { id: record.value.id, number: record.value.number, fileChecksum: record.value.fileChecksum };
  }

  const pending = deps.db.select({ id: financeAllocationCorrections.id }).from(financeAllocationCorrections).where(and(eq(financeAllocationCorrections.lineId, v.lineId), eq(financeAllocationCorrections.state, 'pending'))).get();
  if (pending) return financeConflict('correctionPendingExists');

  const category = deps.db.select().from(financeCategories).where(eq(financeCategories.id, line.categoryId)).get();
  const certifiable = isIncomeLine && category !== undefined && (CERTIFIABLE_INCOME_KINDS as readonly string[]).includes(category.incomeKind ?? '');
  const partyChanges = 'contactId' in changed;
  const abroadChanges = 'abroad' in changed;
  const year = entry.fiscalYearId ? deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, entry.fiscalYearId)).get() : null;
  const taxReturnFiled = !!year?.taxReturnFiledOn;
  const triggersSection153 = taxReturnFiled && ((certifiable && partyChanges) || abroadChanges || purposeChanges);
  if (triggersSection153 && !v.acknowledgeSection153) return financeConflict('section153Unacknowledged');

  const closed = entry.fiscalYearId !== null && fiscalYearStatusInternal(deps.db, entry.fiscalYearId) === 'closed';
  const before: LineFields = { contactId: line.contactId, projectId: line.projectId, purposeId: line.purposeId, abroad: line.abroad };

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const now = isoNow(deps.clock);
      const id = newId();
      tx.insert(financeAllocationCorrections)
        .values({
          id, lineId: v.lineId, entryId: line.entryId, state: 'pending', before: JSON.stringify(before), after: JSON.stringify(changed), note: v.note,
          proofDocumentId: proofDoc?.id ?? null, section153: triggersSection153, requestedByUserId: ctx.userId ?? 'system', requestedAt: now,
          approvedByUserId: null, approvedAt: null, rejectedByUserId: null, rejectedAt: null, rejectNote: null,
        })
        .run();
      if (proofDoc) {
        // Der Zweck-Nachweis hängt an der Buchung wie ein gewöhnlicher Beleg (wie `attachDocument`).
        writeVoucherLink(tx, deps, ctx, { entryId: line.entryId, documentId: proofDoc.id, documentNumber: proofDoc.number ?? '', documentChecksum: proofDoc.fileChecksum, viaUpload: false });
        linkDocumentInternal(tx, deps, { documentId: proofDoc.id, entityType: 'financeEntry', entityId: line.entryId });
      }
      const requested = correctionViewOf(tx, id);
      financeAudit(tx, deps, ctx, { action: 'finance.correction.request', entity: 'financeAllocationCorrection', id, after: auditFieldsFor(requested, 'pending'), summary: `Zuordnungskorrektur ${id} angelegt` });

      const notices: ('section153')[] = triggersSection153 ? ['section153'] : [];
      if (!closed) {
        const applied = applyCorrectionInternal(tx, deps, ctx, id);
        if (!applied.ok) abortCorrection(applied);
        return ok({ correction: applied.value, applied: true, notices });
      }
      return ok({ correction: requested, applied: false, notices });
    });
  } catch (error) {
    if (error instanceof CorrectionAborted) return error.failure;
    throw error;
  }
}

const idSchema = z.object({ id: z.string().min(1) });

/** `finance.approve`, **`humanOnly`**, nie der Anleger (`ownCorrection`). */
export async function approveAllocationCorrection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CorrectionView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const correction = deps.db.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.id, parsed.value.id)).get();
  if (!correction) return notFound('financeAllocationCorrection', parsed.value.id);
  if (correction.state !== 'pending') return financeConflict('correctionNotPending');
  if (correction.requestedByUserId === ctx.userId) return financeConflict('ownCorrection');
  return deps.db.transaction((tx: DbOrTx) => applyCorrectionInternal(tx, deps, ctx, correction.id));
}

const rejectSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(500) });

/** `finance.approve`, **`humanOnly`**. */
export async function rejectAllocationCorrection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CorrectionView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, rejectSchema, input);
  if (!parsed.ok) return parsed;
  const correction = deps.db.select().from(financeAllocationCorrections).where(eq(financeAllocationCorrections.id, parsed.value.id)).get();
  if (!correction) return notFound('financeAllocationCorrection', parsed.value.id);
  if (correction.state !== 'pending') return financeConflict('correctionNotPending');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeAllocationCorrections).set({ state: 'rejected', rejectedByUserId: ctx.userId, rejectedAt: now, rejectNote: parsed.value.note }).where(eq(financeAllocationCorrections.id, correction.id)).run();
    const rejected = correctionViewOf(tx, correction.id);
    financeAudit(tx, deps, ctx, { action: 'finance.correction.reject', entity: 'financeAllocationCorrection', id: correction.id, after: auditFieldsFor(rejected, 'rejected'), summary: `Zuordnungskorrektur ${correction.id} abgelehnt` });
    return ok(rejected);
  });
}

const listSchema = z.object({
  state: z.enum(['pending', 'applied', 'rejected']).optional(),
  entryId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `finance.read`. */
export async function listAllocationCorrections(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: CorrectionView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;
  const conditions = [];
  if (f.state) conditions.push(eq(financeAllocationCorrections.state, f.state));
  if (f.entryId) conditions.push(eq(financeAllocationCorrections.entryId, f.entryId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = deps.db.select().from(financeAllocationCorrections).where(where).orderBy(desc(financeAllocationCorrections.requestedAt)).all();
  const total = rows.length;
  const items = rows.slice(f.offset, f.offset + f.limit);
  return ok({ items, total });
}

const decideSchema = z.object({ id: z.string().min(1), decision: z.enum(['approve', 'reject']), note: z.string().trim().min(1).max(500).optional() });

/** `finance_correction_decide` (Spec 10.2): ein Verteiler statt zweier Werkzeuge — nie die eigene Korrektur, **`humanOnly`** (über die beiden gerufenen Dienste). */
export async function decideAllocationCorrection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CorrectionView>> {
  const parsed = validate(deps, decideSchema, input);
  if (!parsed.ok) return parsed;
  const { id, decision, note } = parsed.value;
  if (decision === 'approve') return approveAllocationCorrection(deps, ctx, { id });
  return rejectAllocationCorrection(deps, ctx, { id, note: note ?? '' });
}
