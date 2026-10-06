import { expectedVersionField, invalid, isoNow, listUserNamesWithPermission, newId, notFound, ok, requirePermission, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { abortReceive, documentTypeFor, getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload, type ReceivedDocument } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { checkDatedInternal, fiscalYearsWithStatusInternal } from '../ledger/fiscal-years';
import { freeReserveInputsAt } from '../ledger/queries';
import { latestMovementDate, reserveBalanceAt, reserveBalancesAt, reserveIsDissolved } from '../ledger/reserve-balances';
import { valueAt } from '../ledger/dated-values';
import { financeFiscalYears, financePurposes, financeReserveMovements, financeReserves, type FinanceReserveMovementRow, type FinanceReserveRow } from '../schema';
import { nextVersion } from './expenses';
import { reserveResolutionSubject } from './subjects';
import { freeReserveCapCents, freeReserveYears } from './reserve-rules';

/**
 * Zurückgelegtes Geld (F8b Task 2, Spec 8.3, Annahme 1–4): Stammsatz,
 * Vorgänge mit Beschluss, Höchstbetrag der freien Rücklage (Näherung), und
 * die Regel gegen den Doppelabzug bei einer zweckgebundenen Rücklage
 * (Annahme 3, Review Focus 4) — hier über `withReservesInternal` für
 * `ledger/overview.ts` bereitgestellt (`ledger` importiert nichts, `allocation`
 * darf `ledger` importieren).
 */


function load(db: DbOrTx, id: string): FinanceReserveRow | null {
  return db.select().from(financeReserves).where(eq(financeReserves.id, id)).get() ?? null;
}

export interface ReserveView extends FinanceReserveRow {
  balanceCents: number;
  isDissolved: boolean;
}

function toView(db: DbOrTx, row: FinanceReserveRow, date: string): ReserveView {
  return { ...row, balanceCents: reserveBalanceAt(row, db.select().from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, row.id)).all(), date), isDissolved: reserveIsDissolved(db, row.id) };
}

/** Ob die Dokumentart „Protokoll“ stillgelegt ist — mit den Namen, die sie wieder einschalten können. */
export function minutesTypeProblem(deps: Deps): Failure | null {
  const type = documentTypeFor(deps.db, 'minutes');
  if (!type || type.isActive) return null;
  const names = listUserNamesWithPermission(deps, 'dms.manage');
  return financeConflict('resolutionTypeInactive', { names: names.length > 0 ? names.join(', ') : '—' });
}

/** Ein gepicktes Dokument: festgeschrieben, nicht widerrufen. */
export async function checkPickedDocument(deps: Deps, ctx: CallContext, documentId: string): Promise<Failure | null> {
  const doc = await getDocumentRecord(deps, ctx, documentId);
  if (!doc.ok) return doc;
  if (doc.value.phase !== 'issued') return financeConflict('documentNotFinal');
  if (doc.value.status === 'voided') return financeConflict('documentVoided');
  return null;
}

const auditFields = (row: FinanceReserveRow) => ({ kind: row.kind, purposeId: row.purposeId, carryForwardCents: row.carryForwardCents, carryForwardDate: row.carryForwardDate, isActive: row.isActive });

export const uploadInputSchema = z.object({
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  fileName: z.string().trim().min(1).max(300),
  documentDate: z.string().date().optional(),
});

export const saveReserveSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  kind: z.enum(['projectFunds', 'replacement', 'free', 'participation']),
  name: z.string().trim().min(1).max(120),
  purposeText: z.string().trim().max(2000).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  carryForwardCents: z.number().int().nullable().optional(),
  carryForwardDate: z.string().date().nullable().optional(),
  isActive: z.boolean().default(true),
  /** Nur beim Anlegen gelesen — Pflicht (Annahme 1); genau eines von beiden: ein vorhandenes, festgeschriebenes Dokument der Akte, oder ein PDF, im Namen des zurückgelegten Geldes hochgeladen. */
  resolutionDocumentId: z.string().min(1).optional(),
  resolutionUpload: uploadInputSchema.optional(),
});

/** `finance.setup`: Stammsatz anlegen oder ändern (Annahme 1). Der Beschluss ist beim Anlegen Pflicht — per Picker oder Upload; danach wird er über `linkResolution`/`uploadResolution` ersetzt oder ergänzt. */
export async function saveReserve(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, saveReserveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? load(deps.db, v.id) : null;
  if (v.id && !before) return notFound('financeReserve', v.id);
  if (before) {
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }
  if ((v.kind === 'projectFunds' || v.kind === 'replacement') && !v.purposeText?.trim()) return financeConflict('reservePurposeTextRequired');
  const carryForwardFields = [v.carryForwardCents ?? null, v.carryForwardDate ?? null];
  const anyCarryForward = carryForwardFields.some((f) => f !== null);
  const allCarryForward = carryForwardFields.every((f) => f !== null);
  if (anyCarryForward !== allCarryForward) return financeConflict('reserveCarryForwardIncomplete');
  // Teil C Task 2: Ein Vortrag kommt nur zusammen mit seinem Beschluss (`recordReserveCarryForward`) — hier darf er unverändert mitreisen oder gelöscht werden.
  if (allCarryForward && (v.carryForwardCents !== (before?.carryForwardCents ?? null) || v.carryForwardDate !== (before?.carryForwardDate ?? null))) return financeConflict('reserveCarryForwardOwnStep');
  if (v.purposeId && !deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, v.purposeId)).get()) return notFound('financePurpose', v.purposeId);

  const fields = { kind: v.kind, name: v.name, purposeText: v.purposeText ?? null, purposeId: v.purposeId ?? null, carryForwardCents: v.carryForwardCents ?? null, carryForwardDate: v.carryForwardDate ?? null, isActive: v.isActive };

  if (!before) {
    if (v.resolutionDocumentId && v.resolutionUpload) return invalid([{ path: 'resolutionUpload', message: 'pickOrUploadNotBoth' }]);
    if (!v.resolutionDocumentId && !v.resolutionUpload) return financeConflict('reserveResolutionRequired');
    const typeProblem = minutesTypeProblem(deps);
    if (typeProblem) return typeProblem;

    if (v.resolutionUpload) {
      if (v.resolutionUpload.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.resolutionUpload.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
      if (!isPdf(v.resolutionUpload.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.resolutionUpload.fileName });
      const id = newId();
      const now = isoNow(deps.clock);
      const result = await receiveGeneratedUpload(deps, ctx, {
        bytes: v.resolutionUpload.bytes,
        typeKey: 'minutes',
        subject: reserveResolutionSubject('resolution', fields.name),
        documentDate: v.resolutionUpload.documentDate ?? todayIn(deps),
        links: [{ entityType: 'financeReserve', entityId: id }],
        afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => {
          tx.insert(financeReserves).values({ id, ...fields, carryForwardDocumentId: null, resolutionDocumentId: doc.id, createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now }).run();
          const after = tx.select().from(financeReserves).where(eq(financeReserves.id, id)).get()!;
          financeAudit(tx, deps, ctx, { action: 'finance.reserve.save', entity: 'financeReserve', id, after: auditFields(after), summary: `Zurückgelegtes Geld ${id} angelegt` });
          return after;
        },
      });
      if (!result.ok) return result;
      return ok(toView(deps.db, result.value.after!, todayIn(deps)));
    }

    const docProblem = await checkPickedDocument(deps, ctx, v.resolutionDocumentId!);
    if (docProblem) return docProblem;
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    if (before) {
      tx.update(financeReserves).set({ ...fields, updatedAt: now }).where(eq(financeReserves.id, id)).run();
    } else {
      tx.insert(financeReserves).values({ id, ...fields, updatedAt: now, carryForwardDocumentId: null, resolutionDocumentId: v.resolutionDocumentId!, createdByUserId: ctx.userId ?? 'system', createdAt: now }).run();
      linkDocumentInternal(tx, deps, { documentId: v.resolutionDocumentId!, entityType: 'financeReserve', entityId: id });
    }
    const after = tx.select().from(financeReserves).where(eq(financeReserves.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.reserve.save', entity: 'financeReserve', id, before: before ? auditFields(before) : undefined, after: auditFields(after), summary: `Zurückgelegtes Geld ${id} ${before ? 'geändert' : 'angelegt'}` });
    return ok(toView(tx, after, todayIn(deps)));
  });
}

export const targetFieldSchema = z.object({ id: z.string().min(1), field: z.enum(['resolution', 'carryForward']) });
export const linkResolutionSchema = targetFieldSchema.extend({ documentId: z.string().min(1) });

/** `finance.entriesWrite`: ein vorhandenes, festgeschriebenes Dokument der Akte als Beschluss (oder Vortragsbeschluss) verknüpfen — auch nach dem Anlegen. */
export async function linkResolution(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkResolutionSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financeReserve', parsed.value.id);
  const docProblem = await checkPickedDocument(deps, ctx, parsed.value.documentId);
  if (docProblem) return docProblem;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const column = parsed.value.field === 'resolution' ? { resolutionDocumentId: parsed.value.documentId } : { carryForwardDocumentId: parsed.value.documentId };
    tx.update(financeReserves).set({ ...column, updatedAt: now }).where(eq(financeReserves.id, before.id)).run();
    linkDocumentInternal(tx, deps, { documentId: parsed.value.documentId, entityType: 'financeReserve', entityId: before.id });
    const after = tx.select().from(financeReserves).where(eq(financeReserves.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.reserve.linkResolution', entity: 'financeReserve', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Beschluss von zurückgelegtem Geld ${before.id} verknüpft` });
    return ok(toView(tx, after, todayIn(deps)));
  });
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const isPdf = (bytes: Uint8Array) => PDF_MAGIC.every((b, i) => bytes[i] === b);
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const megabytes = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

export const uploadResolutionSchema = targetFieldSchema.extend({
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  fileName: z.string().trim().min(1).max(300),
  documentDate: z.string().date().optional(),
});

/** `finance.entriesWrite`: den Beschluss (oder Vortragsbeschluss) als PDF hochladen, im Namen des zurückgelegten Geldes — UI-only (kein MCP-Werkzeug, Global Constraints). */
export async function uploadResolution(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, uploadResolutionSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = load(deps.db, v.id);
  if (!before) return notFound('financeReserve', v.id);
  if (v.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
  if (!isPdf(v.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.fileName });
  const typeProblem = minutesTypeProblem(deps);
  if (typeProblem) return typeProblem;

  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: 'minutes',
    subject: reserveResolutionSubject('resolution', before.name),
    documentDate: v.documentDate ?? todayIn(deps),
    links: [{ entityType: 'financeReserve', entityId: before.id }],
    afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => {
      const column = v.field === 'resolution' ? { resolutionDocumentId: doc.id } : { carryForwardDocumentId: doc.id };
      tx.update(financeReserves).set({ ...column, updatedAt: isoNow(deps.clock) }).where(eq(financeReserves.id, before.id)).run();
      const after = tx.select().from(financeReserves).where(eq(financeReserves.id, before.id)).get()!;
      financeAudit(tx, deps, ctx, { action: 'finance.reserve.uploadResolution', entity: 'financeReserve', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Beschluss ${doc.number} für zurückgelegtes Geld ${before.id} hochgeladen` });
      return after;
    },
  });
  if (!result.ok) return result;
  return ok(toView(deps.db, result.value.after!, todayIn(deps)));
}

export const recordCarryForwardSchema = z.object({
  id: z.string().min(1),
  expectedVersion: expectedVersionField,
  carryForwardCents: z.number().int().nonnegative(),
  carryForwardDate: z.string().date(),
  /** Genau eines oder keines: ein festgeschriebenes Dokument der Akte, oder ein PDF, im Namen des zurückgelegten Geldes hochgeladen. Ohne beides bleibt der schon hinterlegte Vortragsbeschluss — fehlt auch der, wird verweigert. */
  documentId: z.string().min(1).optional(),
  upload: uploadInputSchema.optional(),
});

/**
 * `finance.setup`: Vortrag aus der Zeit vor Kompass erfassen oder ändern —
 * Betrag, Stichtag und Beschluss in einem Schritt und einer Transaktion
 * (Design-Nachtrag Phase 4, Teil C Task 2). Früher waren es zwei Aufrufe
 * (`saveReserve`, dann der Beschluss); scheiterte der zweite, stand der
 * Vortrag ohne Beschluss da.
 */
export async function recordReserveCarryForward(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, recordCarryForwardSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = load(deps.db, v.id);
  if (!before) return notFound('financeReserve', v.id);
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (v.documentId && v.upload) return invalid([{ path: 'upload', message: 'pickOrUploadNotBoth' }]);
  if (!v.documentId && !v.upload && !before.carryForwardDocumentId) return financeConflict('reserveCarryForwardIncomplete');

  const write = (tx: DbOrTx, documentId: string | null) => {
    // Eine neue Fassung auch bei stehender Uhr — sonst ginge ein veralteter zweiter Aufruf durch.
    const fields = { carryForwardCents: v.carryForwardCents, carryForwardDate: v.carryForwardDate, ...(documentId ? { carryForwardDocumentId: documentId } : {}), updatedAt: nextVersion(deps, before.updatedAt) };
    tx.update(financeReserves).set(fields).where(eq(financeReserves.id, before.id)).run();
    const after = tx.select().from(financeReserves).where(eq(financeReserves.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.reserve.carryForward', entity: 'financeReserve', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Vortrag von zurückgelegtem Geld ${before.id} erfasst` });
    return after;
  };

  if (v.upload) {
    if (v.upload.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.upload.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
    if (!isPdf(v.upload.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.upload.fileName });
    const typeProblem = minutesTypeProblem(deps);
    if (typeProblem) return typeProblem;
    const result = await receiveGeneratedUpload(deps, ctx, {
      bytes: v.upload.bytes,
      typeKey: 'minutes',
      subject: reserveResolutionSubject('carryForward', before.name),
      documentDate: v.upload.documentDate ?? todayIn(deps),
      links: [{ entityType: 'financeReserve', entityId: before.id }],
      afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => write(tx, doc.id),
    });
    if (!result.ok) return result;
    return ok(toView(deps.db, result.value.after!, todayIn(deps)));
  }

  if (v.documentId) {
    const docProblem = await checkPickedDocument(deps, ctx, v.documentId);
    if (docProblem) return docProblem;
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const after = write(tx, v.documentId ?? null);
    if (v.documentId) linkDocumentInternal(tx, deps, { documentId: v.documentId, entityType: 'financeReserve', entityId: before.id });
    return ok(toView(tx, after, todayIn(deps)));
  });
}

export const activeReserveSchema = z.object({ id: z.string().min(1), isActive: z.boolean(), expectedVersion: expectedVersionField });

/** `finance.setup`: aktivieren/deaktivieren. */
export async function setReserveActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, activeReserveSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financeReserve', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeReserves).set({ isActive: parsed.value.isActive, updatedAt: now }).where(eq(financeReserves.id, before.id)).run();
    const after = tx.select().from(financeReserves).where(eq(financeReserves.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.reserve.setActive', entity: 'financeReserve', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Zurückgelegtes Geld ${before.id} ${after.isActive ? 'aktiviert' : 'stillgelegt'}` });
    return ok(toView(tx, after, todayIn(deps)));
  });
}

export const reserveIdSchema = z.object({ id: z.string().min(1) });

/** `finance.setup`: löschen — nur ohne Vorgänge und ohne Vortrag (Annahme 1, Löschregel `financeReserve`); der Trigger sichert es zusätzlich. */
export async function deleteReserve(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, reserveIdSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financeReserve', parsed.value.id);
  const hasMovement = deps.db.select({ id: financeReserveMovements.id }).from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, before.id)).get();
  if (hasMovement || before.carryForwardCents !== null) return financeConflict('reserveInUse');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeReserves).where(eq(financeReserves.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.reserve.delete', entity: 'financeReserve', id: before.id, before: auditFields(before), summary: `Zurückgelegtes Geld ${before.id} gelöscht` });
    return ok({ id: before.id });
  });
}

export const listReservesSchema = z.object({ includeInactive: z.boolean().default(false) });

/** `finance.overview`: alle zurückgelegten Geldbeträge mit Bestand (Annahme 1, 3). */
export async function listReserves(deps: Deps, ctx: CallContext, input?: unknown): Promise<Result<ReserveView[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, listReservesSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financeReserves).orderBy(financeReserves.name).all().filter((r) => parsed.value.includeInactive || r.isActive);
  const date = todayIn(deps);
  return ok(rows.map((r) => toView(deps.db, r, date)));
}

// ── Vorgänge (Annahme 2) ────────────────────────────────────────────────────

export interface ReserveMovementView extends FinanceReserveMovementRow {
  balanceAfterCents: number;
}

export const recordReserveMovementSchema = z.object({
  reserveId: z.string().min(1),
  kind: z.enum(['allocate', 'withdraw', 'dissolve']),
  movementDate: z.string().date(),
  amountCents: z.number().int().positive().max(1_000_000_000).optional(),
  forFiscalYearId: z.string().min(1).optional(),
  /** Pflicht — genau eines: ein vorhandenes Dokument der Akte, oder ein PDF, im Namen des Vorgangs hochgeladen. */
  resolutionDocumentId: z.string().min(1).optional(),
  resolutionUpload: uploadInputSchema.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  /** Befund S: Pflicht, wenn die Zuführung die freie Rücklage über den Höchstbetrag des Jahres bringt — steht am Vorgang, nie im Protokoll. */
  capReason: z.string().trim().max(1000).optional(),
});

/** Befund S: was eine Zuführung zur freien Rücklage über den Höchstbetrag des Jahres brächte — `null`, wenn nichts. */
function capOverrun(db: DbOrTx, reserve: FinanceReserveRow, v: z.infer<typeof recordReserveMovementSchema>, yearId: string): { capCents: number; overCents: number } | null {
  if (reserve.kind !== 'free' || v.kind !== 'allocate') return null;
  const cap = freeReserveCapInternal(db, yearId);
  if (!cap) return null;
  const overCents = cap.usedCents + v.amountCents! - cap.capCents;
  return overCents > 0 ? { capCents: cap.capCents, overCents: Math.min(overCents, v.amountCents!) } : null;
}

/** Datums-, Reihenfolge- und Bestandsprüfung plus Einfügen — geteilt zwischen dem Picker- und dem Upload-Weg (beide brauchen eine eigene Transaktion). */
function insertMovement(tx: DbOrTx, deps: Deps, ctx: CallContext, reserve: FinanceReserveRow, v: z.infer<typeof recordReserveMovementSchema>, resolutionDocumentId: string): Result<ReserveMovementView> {
  const yearCheck = checkDatedInternal(tx, deps, ctx, v.movementDate, 'movementDateInFuture');
  if (!yearCheck.ok) return yearCheck;
  const existingMovements = tx.select().from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, reserve.id)).all();
  const balanceAtDate = reserveBalanceAt(reserve, existingMovements, v.movementDate);

  let amountCents: number;
  if (v.kind === 'dissolve') amountCents = Math.max(0, balanceAtDate);
  else if (v.kind === 'withdraw') {
    if (v.amountCents! > balanceAtDate) return financeConflict('reserveInsufficient', { date: v.movementDate, name: reserve.name, available: balanceAtDate, amount: v.amountCents! });
    amountCents = v.amountCents!;
  } else amountCents = v.amountCents!;

  const now = isoNow(deps.clock);
  const id = newId();
  // Befund 4 (0.2.7): Das Jahr einer Zuführung zur freien Rücklage wird nie geraten. Ohne Angabe nimmt der Dienst das
  // Jahr nur, wenn am Vorgangstag genau eines in Frage kommt (`freeReserveYears`); ist das Vorjahr noch offen, lehnt
  // er ab und nennt beide. Dieselbe Regel für Oberfläche und MCP — die Oberfläche schickt das Jahr immer mit.
  let forFiscalYearId: string | null = null;
  if (v.kind === 'allocate' && reserve.kind === 'free') {
    if (v.forFiscalYearId) forFiscalYearId = v.forFiscalYearId;
    else {
      const inQuestion = freeReserveYears(fiscalYearsWithStatusInternal(tx), v.movementDate).years;
      if (inQuestion.length > 1) return financeConflict('reserveYearAmbiguous', { previous: inQuestion[0]!.designation, current: inQuestion[1]!.designation });
      forFiscalYearId = yearCheck.value.id;
    }
  }
  const overrun = forFiscalYearId ? capOverrun(tx, reserve, v, forFiscalYearId) : null;
  if (overrun && !v.capReason) return financeConflict('freeReserveCapExceeded', { cap: overrun.capCents, over: overrun.overCents });
  tx.insert(financeReserveMovements).values({ id, reserveId: reserve.id, kind: v.kind, movementDate: v.movementDate, amountCents, forFiscalYearId, resolutionDocumentId, note: v.note ?? null, capReason: overrun ? v.capReason! : null, createdByUserId: ctx.userId ?? 'system', createdAt: now }).run();
  linkDocumentInternal(tx, deps, { documentId: resolutionDocumentId, entityType: 'financeReserveMovement', entityId: id });
  const after = tx.select().from(financeReserveMovements).where(eq(financeReserveMovements.id, id)).get()!;
  financeAudit(tx, deps, ctx, { action: 'finance.reserveMovement.record', entity: 'financeReserveMovement', id, after: { reserveId: reserve.id, kind: v.kind, movementDate: v.movementDate, amountCents, forFiscalYearId }, summary: `Vorgang ${id} an zurückgelegtem Geld ${reserve.id} erfasst` });
  const balanceAfterCents = reserveBalanceAt(reserve, [...existingMovements, after], v.movementDate);
  return ok({ ...after, balanceAfterCents });
}

/**
 * `finance.entriesWrite`: einen Vorgang erfassen (Annahme 2). `dissolve`
 * nimmt nie einen Betrag vom Aufrufer — er ist der Bestand am Vorgangstag,
 * berechnet und gespeichert. Keine Buchung, kein Konto, keine EÜR (Prüfstein 8).
 * A7 (E10): Der Vorgang ist sofort unveränderlich (Trigger) — nur ein Mensch,
 * über MCP erst mit `finance.mcpHumanOnlyAllowed`.
 */
export async function recordReserveMovement(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReserveMovementView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, recordReserveMovementSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.resolutionDocumentId && v.resolutionUpload) return invalid([{ path: 'resolutionUpload', message: 'pickOrUploadNotBoth' }]);
  if (!v.resolutionDocumentId && !v.resolutionUpload) return financeConflict('reserveResolutionRequired');
  const reserve = load(deps.db, v.reserveId);
  if (!reserve) return notFound('financeReserve', v.reserveId);
  if (reserveIsDissolved(deps.db, reserve.id)) return financeConflict('reserveDissolved');
  if (v.kind !== 'dissolve' && (v.amountCents === undefined || v.amountCents <= 0)) return invalid([{ path: 'amountCents', message: 'required' }]);
  const latest = latestMovementDate(deps.db, reserve.id);
  if (latest !== null && v.movementDate < latest) return financeConflict('reserveMovementOutOfOrder', { date: v.movementDate });
  const typeProblem = minutesTypeProblem(deps);
  if (typeProblem) return typeProblem;

  if (v.resolutionUpload) {
    if (v.resolutionUpload.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.resolutionUpload.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
    if (!isPdf(v.resolutionUpload.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.resolutionUpload.fileName });
    const result = await receiveGeneratedUpload(deps, ctx, {
      bytes: v.resolutionUpload.bytes,
      typeKey: 'minutes',
      subject: reserveResolutionSubject('movement', reserve.name),
      documentDate: v.resolutionUpload.documentDate ?? todayIn(deps),
      links: [{ entityType: 'financeReserve', entityId: reserve.id }],
      // Befund 6 (0.2.7): Lehnt `insertMovement` ab, rollt `abortReceive` den Eingang mit zurück — kein Beschluss bleibt in der Akte.
      afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => {
        const movement = insertMovement(tx, deps, ctx, reserve, v, doc.id);
        if (!movement.ok) abortReceive(movement);
        return movement;
      },
    });
    if (!result.ok) return result;
    return result.value.after!;
  }

  const docProblem = await checkPickedDocument(deps, ctx, v.resolutionDocumentId!);
  if (docProblem) return docProblem;
  return deps.db.transaction((tx: DbOrTx) => insertMovement(tx, deps, ctx, reserve, v, v.resolutionDocumentId!));
}

// ── Höchstbetrag der freien Rücklage (Annahme 4) ────────────────────────────

export interface FreeReserveCapView {
  capCents: number;
  usedCents: number;
  assetManagementSurplusCents: number;
  otherTimelyFundsCents: number;
  /** Befund S: die Zuführungen für das Jahr liegen über dem Höchstbetrag — mit dem Betrag darüber. */
  exceeded: boolean;
  overCents: number;
}

export const freeReserveCapSchema = z.object({ fiscalYearId: z.string().min(1) });

/**
 * `finance.overview`: der Höchstbetrag der freien Rücklage für ein
 * Geschäftsjahr — **Näherung**, keine Sperre (Annahme 4). „Davon genutzt“ ist
 * Σ `allocate` in freien Rücklagen mit `forFiscalYearId` = dieses Jahr.
 */
export async function freeReserveCap(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FreeReserveCapView>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, freeReserveCapSchema, input);
  if (!parsed.ok) return parsed;
  const cap = freeReserveCapInternal(deps.db, parsed.value.fiscalYearId);
  if (!cap) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok(cap);
}

export interface FreeReserveCapYearView extends FreeReserveCapView {
  fiscalYearId: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  /** Das Vorjahr, solange es nicht abgeschlossen ist — sein Höchstbetrag ist vorläufig. */
  provisional: boolean;
}

export interface FreeReserveCapOverview {
  /** Älteres Jahr zuerst (`freeReserveYears`); leer ohne Geschäftsjahr für heute und ohne offenes Vorjahr. */
  years: FreeReserveCapYearView[];
  /** Der Vorschlag für eine Zuführung zur freien Rücklage: das offene Vorjahr, sonst das laufende Jahr. */
  defaultFiscalYearId: string | null;
}

export const freeReserveCapOverviewSchema = z.object({}).strict();

/**
 * `finance.overview`: der Höchstbetrag der freien Rücklage für die Jahre, die
 * heute zählen (Befund 4, Fassung 0.2.7) — das offene Vorjahr („vorläufig“)
 * und das laufende. Dieselbe Regel wie die Jahrespflicht beim Zuführen
 * (`insertMovement`) und die Kachel `reserveCapNear`.
 */
export async function freeReserveCapOverview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FreeReserveCapOverview>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, freeReserveCapOverviewSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const pick = freeReserveYears(fiscalYearsWithStatusInternal(deps.db), todayIn(deps));
  const years = pick.years.map((y) => ({
    fiscalYearId: y.id,
    designation: y.designation,
    startsOn: y.startsOn,
    endsOn: y.endsOn,
    provisional: y.provisional,
    ...freeReserveCapInternal(deps.db, y.id)!,
  }));
  return ok({ years, defaultFiscalYearId: pick.defaultFiscalYearId });
}

/** Der Höchstbetrag ohne Rechteprüfung — auch für die Warnung beim Zuführen (Befund S). `null` ohne dieses Jahr. */
function freeReserveCapInternal(db: DbOrTx, fiscalYearId: string): FreeReserveCapView | null {
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (!year) return null;
  const { assetManagementSurplusCents, otherTimelyFundsCents } = freeReserveInputsAt(db, { from: year.startsOn, to: year.endsOn });
  const assetSharePercent = (valueAt(db, 'freeReserveAssetShare', year.endsOn) as number | null) ?? 0;
  const otherSharePercent = (valueAt(db, 'freeReserveOtherShare', year.endsOn) as number | null) ?? 0;
  const capCents = freeReserveCapCents({ assetManagementSurplusCents, otherTimelyFundsCents, assetSharePercent, otherSharePercent });

  const freeReserveIds = new Set(db.select({ id: financeReserves.id }).from(financeReserves).where(eq(financeReserves.kind, 'free')).all().map((r) => r.id));
  const usedCents = db
    .select()
    .from(financeReserveMovements)
    .where(and(eq(financeReserveMovements.kind, 'allocate'), eq(financeReserveMovements.forFiscalYearId, year.id)))
    .all()
    .filter((m) => freeReserveIds.has(m.reserveId))
    .reduce((sum, m) => sum + m.amountCents, 0);

  const overCents = Math.max(0, usedCents - capCents);
  return { capCents, usedCents, assetManagementSurplusCents, otherTimelyFundsCents, exceeded: overCents > 0, overCents };
}

export { reserveBalancesAt };
