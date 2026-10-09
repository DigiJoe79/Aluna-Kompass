import { yearIn, invalid, isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { abortReceive, linkDocumentInternal, receiveGeneratedUpload, type ReceivedDocument } from '@kompass/module-dms';
import { and, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { checkDatedInternal } from '../ledger/fiscal-years';
import { purposeBalancesAt } from '../ledger/queries';
import { financeAllocationLines, financeEntries, financePurposeTransferCounters, financePurposeTransfers, financePurposes, type FinancePurposeRow, type FinancePurposeTransferRow } from '../schema';
import { checkPickedDocument, minutesTypeProblem, uploadInputSchema } from './reserves';
import { transferResolutionSubject } from './subjects';

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const isPdf = (bytes: Uint8Array) => PDF_MAGIC.every((b, i) => bytes[i] === b);
const megabytes = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/**
 * Zweck ändern (Umwidmung, F8b Task 3, Spec 8.4, Annahme 5): entsteht ohne
 * Entwurf, sofort mit Nummer; Freigabe durch eine zweite Person
 * (`finance.approve`, humanOnly, ≠ Anleger). Bewegt nie ein Bankkonto oder
 * eine Kasse und erscheint nie in der EÜR (Prüfstein 9).
 */

function purposeOf(db: DbOrTx, id: string): FinancePurposeRow | undefined {
  return db.select().from(financePurposes).where(eq(financePurposes.id, id)).get();
}

/** Annahme 5: das Ziel darf nie erfüllt oder aufgelöst sein — auch bei der Freigabe erneut geprüft. */
function targetClosedProblem(target: FinancePurposeRow | undefined): Failure | null {
  return target && (target.fulfilledAt || target.dissolvedAt) ? financeConflict('purposeClosed') : null;
}

export interface TransferSide {
  purposeId: string | null;
  name: string | null;
  beforeCents: number | null;
  afterCents: number | null;
}

export interface TransferView extends FinancePurposeTransferRow {
  fromName: string | null;
  toName: string | null;
  from: TransferSide;
  to: TransferSide;
  /** Datenfeld, keine Sperre (Annahme 5): die Quelle wäre am Vorgangstag im Minus. */
  sourceWouldGoNegative: boolean;
}

function toView(db: DbOrTx, row: FinancePurposeTransferRow): TransferView {
  const from = row.fromPurposeId ? purposeOf(db, row.fromPurposeId) : undefined;
  const to = row.toPurposeId ? purposeOf(db, row.toPurposeId) : undefined;
  const balances = purposeBalancesAt(db, row.transferDate);
  const balanceOf = (id: string | null) => (id ? balances.find((b) => b.purposeId === id)?.balanceCents ?? 0 : null);
  const fromBefore = balanceOf(row.fromPurposeId);
  const toBefore = balanceOf(row.toPurposeId);
  return {
    ...row,
    fromName: from?.name ?? null,
    toName: to?.name ?? null,
    from: { purposeId: row.fromPurposeId, name: from?.name ?? null, beforeCents: fromBefore, afterCents: fromBefore !== null ? fromBefore - row.amountCents : null },
    to: { purposeId: row.toPurposeId, name: to?.name ?? null, beforeCents: toBefore, afterCents: toBefore !== null ? toBefore + row.amountCents : null },
    sourceWouldGoNegative: fromBefore !== null && fromBefore - row.amountCents < 0,
  };
}

const auditFields = (row: FinancePurposeTransferRow) => ({
  state: row.state, number: row.number, fromPurposeId: row.fromPurposeId, toPurposeId: row.toPurposeId, amountCents: row.amountCents, transferDate: row.transferDate,
  approvedAt: row.approvedAt, rejected: row.state === 'rejected', channel: row.approvedChannel,
});

/** Nur in einer Transaktion. Fortlaufend je Jahr des Anlegens, Form `UM-<Jahr>-NNN`. */
function allocateTransferNumber(tx: DbOrTx, year: number): string {
  const counter = tx.select().from(financePurposeTransferCounters).where(eq(financePurposeTransferCounters.year, year)).get();
  const next = (counter?.last ?? 0) + 1;
  if (counter) tx.update(financePurposeTransferCounters).set({ last: next }).where(eq(financePurposeTransferCounters.year, year)).run();
  else tx.insert(financePurposeTransferCounters).values({ year, last: next }).run();
  return `UM-${year}-${String(next).padStart(3, '0')}`;
}

export const requestTransferSchema = z.object({
  fromPurposeId: z.string().min(1).nullable(),
  toPurposeId: z.string().min(1).nullable(),
  amountCents: z.number().int().positive().max(1_000_000_000),
  transferDate: z.string().date(),
  reason: z.string().trim().min(1).max(1000),
  /** Pflicht (Annahme 5) — genau eines: ein vorhandenes, festgeschriebenes Dokument der Akte, oder ein PDF, im Namen der Umwidmung hochgeladen. */
  documentId: z.string().min(1).optional(),
  documentUpload: uploadInputSchema.optional(),
});

/** Datumsprüfung, Nummer, Einfügen, Verknüpfen und Protokoll — geteilt zwischen dem Picker- und dem Upload-Weg. `id` steht schon vorher fest, damit der Upload-Weg dasselbe `id` im Bezug (`links`) verwenden kann. */
function insertTransfer(tx: DbOrTx, deps: Deps, ctx: CallContext, v: z.infer<typeof requestTransferSchema>, id: string, documentId: string): Result<TransferView> {
  const yearCheck = checkDatedInternal(tx, deps, ctx, v.transferDate, 'transferDateInFuture');
  if (!yearCheck.ok) return yearCheck;
  const now = isoNow(deps.clock);
  const number = allocateTransferNumber(tx, yearIn(deps));
  tx.insert(financePurposeTransfers)
    .values({ id, number, fromPurposeId: v.fromPurposeId, toPurposeId: v.toPurposeId, amountCents: v.amountCents, transferDate: v.transferDate, reason: v.reason, documentId, state: 'submitted', createdByUserId: ctx.userId ?? 'system', createdAt: now })
    .run();
  linkDocumentInternal(tx, deps, { documentId, entityType: 'financePurposeTransfer', entityId: id });
  const after = tx.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, id)).get()!;
  financeAudit(tx, deps, ctx, { action: 'finance.purposeTransfer.request', entity: 'financePurposeTransfer', id, after: auditFields(after), params: { number } });
  return ok(toView(tx, after));
}

/** `finance.entriesWrite`: eine Umwidmung anlegen — sofort `submitted`, mit Nummer (Annahme 5). */
export async function requestPurposeTransfer(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TransferView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, requestTransferSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.documentId && v.documentUpload) return invalid([{ path: 'documentUpload', message: 'pickOrUploadNotBoth' }]);
  if (!v.documentId && !v.documentUpload) return financeConflict('transferDocumentRequired');
  if (v.fromPurposeId === null && v.toPurposeId === null) return financeConflict('transferNoPurposes');
  if (v.fromPurposeId !== null && v.fromPurposeId === v.toPurposeId) return financeConflict('transferSamePurpose');

  const from = v.fromPurposeId ? purposeOf(deps.db, v.fromPurposeId) : undefined;
  if (v.fromPurposeId && !from) return notFound('financePurpose', v.fromPurposeId);
  const to = v.toPurposeId ? purposeOf(deps.db, v.toPurposeId) : undefined;
  if (v.toPurposeId && !to) return notFound('financePurpose', v.toPurposeId);
  const closed = targetClosedProblem(to);
  if (closed) return closed;

  const typeProblem = minutesTypeProblem(deps);
  if (typeProblem) return typeProblem;

  if (v.documentUpload) {
    if (v.documentUpload.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('resolutionFileTooLarge', { file: v.documentUpload.fileName, limit: megabytes(DOCUMENT_MAX_BYTES) });
    if (!isPdf(v.documentUpload.bytes)) return financeConflict('resolutionFileNotPdf', { file: v.documentUpload.fileName });
    const id = newId();
    const result = await receiveGeneratedUpload(deps, ctx, {
      bytes: v.documentUpload.bytes,
      typeKey: 'minutes',
      subject: transferResolutionSubject(from?.name ?? null, to?.name ?? null),
      documentDate: v.documentUpload.documentDate ?? todayIn(deps),
      links: [{ entityType: 'financePurposeTransfer', entityId: id }],
      // Befund 6 (0.2.7): Lehnt `insertTransfer` ab, rollt `abortReceive` den Eingang mit zurück — kein Beschluss bleibt in der Akte.
      afterReceive: (tx: DbOrTx, doc: ReceivedDocument) => {
        const transfer = insertTransfer(tx, deps, ctx, v, id, doc.id);
        if (!transfer.ok) abortReceive(transfer);
        return transfer;
      },
    });
    if (!result.ok) return result;
    return result.value.after!;
  }

  const docProblem = await checkPickedDocument(deps, ctx, v.documentId!);
  if (docProblem) return docProblem;

  return deps.db.transaction((tx: DbOrTx) => insertTransfer(tx, deps, ctx, v, newId(), v.documentId!));
}

export const transferIdSchema = z.object({ id: z.string().min(1) });

/** `finance.approve`, humanOnly, ≠ Anleger. `state` verlässt `submitted` genau einmal (Trigger, Review Focus 2). Prüft Ziel und Datum erneut. */
export async function approvePurposeTransfer(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TransferView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, transferIdSchema, input);
  if (!parsed.ok) return parsed;
  const transfer = deps.db.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, parsed.value.id)).get();
  if (!transfer) return notFound('financePurposeTransfer', parsed.value.id);
  if (transfer.state !== 'submitted') return financeConflict('transferNotSubmitted');
  if (ctx.userId && ctx.userId === transfer.createdByUserId) return financeConflict('transferOwn');
  const to = transfer.toPurposeId ? purposeOf(deps.db, transfer.toPurposeId) : undefined;
  const closed = targetClosedProblem(to);
  if (closed) return closed;

  return deps.db.transaction((tx: DbOrTx) => {
    const yearCheck = checkDatedInternal(tx, deps, ctx, transfer.transferDate, 'transferDateInFuture');
    if (!yearCheck.ok) return yearCheck;
    const now = isoNow(deps.clock);
    const changed = tx
      .update(financePurposeTransfers)
      .set({ state: 'approved', approvedByUserId: ctx.userId ?? 'system', approvedAt: now, approvedChannel: ctx.channel })
      .where(and(eq(financePurposeTransfers.id, transfer.id), eq(financePurposeTransfers.state, 'submitted')))
      .run().changes;
    if (changed !== 1) return financeConflict('transferNotSubmitted');
    const after = tx.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, transfer.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.purposeTransfer.approve', entity: 'financePurposeTransfer', id: transfer.id, before: { state: 'submitted' }, after: auditFields(after), params: { number: transfer.number } });
    return ok(toView(tx, after));
  });
}

export const rejectTransferSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/** `finance.approve`, nicht humanOnly: der Grund steht am Vorgang, im Protokoll nur `rejected`. */
export async function rejectPurposeTransfer(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TransferView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, rejectTransferSchema, input);
  if (!parsed.ok) return parsed;
  const transfer = deps.db.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, parsed.value.id)).get();
  if (!transfer) return notFound('financePurposeTransfer', parsed.value.id);
  if (transfer.state !== 'submitted') return financeConflict('transferNotSubmitted');
  return deps.db.transaction((tx: DbOrTx) => {
    const changed = tx
      .update(financePurposeTransfers)
      .set({ state: 'rejected', rejectedByUserId: ctx.userId ?? 'system', rejectedAt: isoNow(deps.clock), rejectNote: parsed.value.note })
      .where(and(eq(financePurposeTransfers.id, transfer.id), eq(financePurposeTransfers.state, 'submitted')))
      .run().changes;
    if (changed !== 1) return financeConflict('transferNotSubmitted');
    const after = tx.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, transfer.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.purposeTransfer.reject', entity: 'financePurposeTransfer', id: transfer.id, before: { state: 'submitted' }, after: auditFields(after), params: { number: transfer.number } });
    return ok(toView(tx, after));
  });
}

/** `finance.read`: die Umwidmung mit Vorher/Nachher je Seite, für die gemeinsame Detailansicht. */
export async function getPurposeTransfer(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TransferView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, transferIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.id, parsed.value.id)).get();
  if (!row) return notFound('financePurposeTransfer', parsed.value.id);
  return ok(toView(deps.db, row));
}

export const listTransfersSchema = z.object({ purposeId: z.string().min(1).optional() });

/** `finance.read`: jüngste zuerst. */
export async function listPurposeTransfers(deps: Deps, ctx: CallContext, input?: unknown): Promise<Result<TransferView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listTransfersSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financePurposeTransfers).all().filter((r) => !parsed.value.purposeId || r.fromPurposeId === parsed.value.purposeId || r.toPurposeId === parsed.value.purposeId);
  return ok(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => toView(deps.db, r)));
}

// ── Bewegungen eines Zwecks (Annahme 8) ─────────────────────────────────────

export interface PurposeMovementLine {
  date: string;
  kind: 'carryForward' | 'line' | 'transferIn' | 'transferOut';
  amountCents: number;
  runningBalanceCents: number;
  entryId?: string;
  transferId?: string;
  transferNumber?: string;
  /** Buchungsnummer der Zeile (E3 „Buchung“, Design-Nachtrag Phase 4). */
  entryNumber?: string | null;
  /** Buchungstext, bei einer Umwidmung ihre Begründung. */
  text?: string;
  /** Spender oder Empfänger der Zeile — nur unter `finance.read`, wie die ganze Liste. */
  counterpartyName?: string | null;
}

const KIND_RANK: Record<PurposeMovementLine['kind'], number> = { carryForward: 0, line: 1, transferIn: 2, transferOut: 2 };

/** Vortrag, festgeschriebene Zuordnungszeilen, freigegebene Umwidmungen — mit laufendem Stand (Annahme 8). */
export function purposeMovementsInternal(db: DbOrTx, purposeId: string): PurposeMovementLine[] {
  const purpose = purposeOf(db, purposeId);
  if (!purpose) return [];
  const lines: PurposeMovementLine[] = [];
  if (purpose.carryForwardCents !== null && purpose.carryForwardDate !== null) {
    lines.push({ date: purpose.carryForwardDate, kind: 'carryForward', amountCents: purpose.carryForwardCents, runningBalanceCents: 0 });
  }
  const allocationRows = db
    .select({ amountCents: financeAllocationLines.amountCents, entryId: financeAllocationLines.entryId, entryDate: financeEntries.entryDate, entryNumber: financeEntries.number, text: financeEntries.text, contactId: financeAllocationLines.contactId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeAllocationLines.purposeId, purposeId), eq(financeEntries.status, 'final')))
    .all();
  const contactIds = [...new Set(allocationRows.map((r) => r.contactId).filter((id): id is string => !!id))];
  const names = new Map((contactIds.length === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, contactIds)).all()).map((c) => [c.id, displayName(c)] as const));
  for (const row of allocationRows) {
    lines.push({ date: row.entryDate, kind: 'line', amountCents: row.amountCents, runningBalanceCents: 0, entryId: row.entryId, entryNumber: row.entryNumber, text: row.text, counterpartyName: row.contactId ? names.get(row.contactId) ?? null : null });
  }
  const transfers = db
    .select()
    .from(financePurposeTransfers)
    .where(and(eq(financePurposeTransfers.state, 'approved'), or(eq(financePurposeTransfers.fromPurposeId, purposeId), eq(financePurposeTransfers.toPurposeId, purposeId))))
    .all();
  for (const t of transfers) {
    const isIn = t.toPurposeId === purposeId;
    lines.push({ date: t.transferDate, kind: isIn ? 'transferIn' : 'transferOut', amountCents: isIn ? t.amountCents : -t.amountCents, runningBalanceCents: 0, transferId: t.id, transferNumber: t.number, text: t.reason });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  let running = 0;
  return lines.map((l) => {
    running += l.amountCents;
    return { ...l, runningBalanceCents: running };
  });
}

export const purposeMovementsSchema = z.object({ purposeId: z.string().min(1) });

/** `finance.read`. */
export async function purposeMovements(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeMovementLine[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, purposeMovementsSchema, input);
  if (!parsed.ok) return parsed;
  if (!purposeOf(deps.db, parsed.value.purposeId)) return notFound('financePurpose', parsed.value.purposeId);
  return ok(purposeMovementsInternal(deps.db, parsed.value.purposeId));
}

// ── Übersicht E3 (Annahme 7) ─────────────────────────────────────────────────

export interface PurposeOverviewRow {
  id: string;
  name: string;
  targetCents: number | null;
  balanceCents: number;
  state: 'open' | 'fulfilled' | 'dissolved';
  negative: boolean;
  fulfilledWithRest: boolean;
  /**
   * Vortrag, Zugänge, Verwendung und Umwidmungen sind Bewegungen — sie fehlen
   * unter `finance.overview` allein, statt dort 0 zu behaupten (Befund 40).
   */
  transfersInCents?: number;
  transfersOutCents?: number;
  carryForwardCents?: number;
  inflowCents?: number;
  outflowCents?: number;
  description: string | null;
  /** Bezug (`reference_note`) — nur mit `finance.read` (Designer-README 4c). */
  referenceNote: string | null;
  projectId: string | null;
  abroad: boolean | null;
  /** `expectedVersion` für Erfüllen/Wiederöffnen — nur mit `finance.read`. */
  updatedAt: string | null;
}

export const purposeOverviewSchema = z.object({ date: z.string().date().optional() });

/**
 * `finance.overview`: die Zwecke für E3 (Annahme 7). Mit `finance.overview`
 * allein — ohne `finance.read` — nur Stände ohne Namen, Beschreibung oder
 * Bezug: `id, name, targetCents, balanceCents, state, negative,
 * fulfilledWithRest`; Vortrag, Zugänge, Verwendung und Umwidmungen fehlen dann
 * ganz (Bewegungen, Designer-README 4c). `listPurposes` bleibt unverändert für ihre acht Aufrufer.
 */
export async function purposeOverview(deps: Deps, ctx: CallContext, input?: unknown): Promise<Result<PurposeOverviewRow[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, purposeOverviewSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const full = requireFinanceRead(ctx, 'read') === null;
  const date = parsed.value.date ?? todayIn(deps);
  const balances = purposeBalancesAt(deps.db, date);
  const purposes = new Map(deps.db.select().from(financePurposes).all().map((p) => [p.id, p]));

  return ok(
    balances.map((b) => {
      const p = purposes.get(b.purposeId)!;
      const row: PurposeOverviewRow = {
        id: p.id, name: p.name, targetCents: p.targetCents, balanceCents: b.balanceCents, state: b.state, negative: b.negative,
        fulfilledWithRest: b.state === 'fulfilled' && b.balanceCents > 0,
        description: null, referenceNote: null, projectId: null, abroad: null, updatedAt: null,
      };
      if (!full) return row;
      return {
        ...row, transfersInCents: b.transfersInCents, transfersOutCents: b.transfersOutCents,
        carryForwardCents: b.carryForwardCents, inflowCents: b.inflowCents, outflowCents: b.outflowCents,
        description: p.description, referenceNote: p.referenceNote, projectId: p.projectId, abroad: p.abroad, updatedAt: p.updatedAt,
      };
    }),
  );
}
