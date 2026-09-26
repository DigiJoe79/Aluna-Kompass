import { expectedVersionField, hasPermission, invalid, isoNow, notFound, ok, requirePermission, schema, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result, type ValidationIssue } from '@kompass/core';
import { contactIdForUserInternal } from '@kompass/module-contacts';
import { documents, linkDocumentInternal } from '@kompass/module-dms';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { formatEuro } from '../ledger/cash-check';
import { resolveEntryLines } from '../ledger/entries';
import { bookEntryInternal } from '../ledger/finalize';
import { createOpenItemInternal } from '../ledger/open-items';
import { writeVoucherLink } from '../ledger/vouchers';
import { financeCategories, financeContactBankAccounts, financeExpenseClaims, financeExpensePositions, financePurposes, type FinanceCategoryRow, type FinanceExpenseClaimRow, type FinanceExpensePositionRow } from '../schema';
import { expenseClaimViewInternal, nextVersion, positionsOf, sumCents, waiversEnabled, type ExpenseClaimView } from './expenses';
import { evaluateWaiverInternal, type WaiverCheck } from './waiver';

/**
 * Die Freigabe einer Auslage (F8a Task 3, Spec 8.2): Warteschlange, Detail,
 * freigeben, ablehnen, die Prüfliste des Verzichts. Alles unter
 * `finance.approve` — **nie für eigene Anträge** (Spec 10.1): Freigebender ≠
 * Anleger und sein Kontakt ≠ Antragsteller. Die Freigabe legt den offenen
 * Posten bzw. die Buchung der Aufwandsspende im Namen des Vorgangs an; sie
 * braucht dafür kein Buchungsrecht. Ins Protokoll kommen Zustand, Nummer,
 * Beträge, IDs — nie Ablehnungsgrund, Begründung, IBAN.
 */

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

/** Tage auf ein ISO-Datum. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Annahme 8: Fälligkeit der offenen Zahlung — feste Vorgabe, 14 Tage nach der Freigabe. */
const PAYABLE_DUE_DAYS = 14;

class ApprovalAborted extends Error {
  constructor(readonly failure: Failure) {
    super('approval aborted');
    this.name = 'ApprovalAborted';
  }
}
const abort = (failure: Failure): never => {
  throw new ApprovalAborted(failure);
};

function loadClaim(deps: Deps, claimId: string): Result<FinanceExpenseClaimRow> {
  const claim = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claimId)).get();
  return claim ? ok(claim) : notFound('financeExpenseClaim', claimId);
}

function userName(db: DbOrTx, userId: string | null): string | null {
  if (!userId) return null;
  return db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).get()?.name ?? null;
}

/**
 * Der eigene Antrag — angelegt vom Betrachter oder für seinen Kontakt — wird
 * nie von ihm entschieden. Die Meldung nennt, wer es erledigen kann (für den
 * `BlockedState`).
 */
function ownClaimProblem(deps: Deps, ctx: CallContext, claim: FinanceExpenseClaimRow): Failure | null {
  const created = !!ctx.userId && claim.submittedByUserId === ctx.userId;
  const sameContact = !!ctx.userId && contactIdForUserInternal(deps.db, ctx.userId) === claim.contactId;
  if (!created && !sameContact) return null;
  const self = userName(deps.db, ctx.userId);
  const names = expenseClaimViewInternal(deps, deps.db, claim.id)!.approverNames.filter((n) => n !== self);
  return financeConflict(created ? 'expenseOwnClaim' : 'expenseSameContact', { names: names.length > 0 ? names.join(', ') : '—' });
}

// ── Warteschlange ───────────────────────────────────────────────────────────

export interface ApprovalQueueItem {
  kind: 'expenseClaim';
  claimId: string;
  number: string;
  contactName: string;
  totalCents: number;
  submittedAt: string;
  waiver: boolean;
}

const listSchema = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/** Annahme 7: eingereichte Anträge, älteste zuerst, ohne die eigenen des Betrachters. Ohne IBAN. */
export async function listApprovals(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: ApprovalQueueItem[]; total: number }>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const ownContact = ctx.userId ? contactIdForUserInternal(deps.db, ctx.userId) : null;
  const rows = deps.db
    .select()
    .from(financeExpenseClaims)
    .where(eq(financeExpenseClaims.state, 'submitted'))
    .orderBy(asc(financeExpenseClaims.submittedAt), asc(financeExpenseClaims.number))
    .all()
    .filter((c) => c.submittedByUserId !== ctx.userId && c.contactId !== ownContact);
  const items = rows.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit).map((c): ApprovalQueueItem => {
    const view = expenseClaimViewInternal(deps, deps.db, c.id)!;
    return { kind: 'expenseClaim', claimId: c.id, number: c.number!, contactName: view.contactName, totalCents: view.totalCents, submittedAt: c.submittedAt!, waiver: c.waiver };
  });
  return ok({ items, total: rows.length });
}

// ── Detail ──────────────────────────────────────────────────────────────────

const claimIdSchema = z.object({ claimId: z.string().min(1) });

export interface ApprovalView extends ExpenseClaimView {
  /** Mit `finance.read`: volle IBAN und Belege. Ohne: maskierte IBAN, keine Dokument-IDs (Annahme 6). */
  receiptsVisible: boolean;
  /** Befund 4: weder für den Kontakt gelernt noch in einem früheren Antrag verwendet — ein Hinweis, keine Sperre. */
  ibanUnknown: boolean;
}

/** Weder als Kontakt-IBAN gelernt noch in einem früheren Antrag derselben Person verwendet. Ein Verzicht hat keine IBAN. */
function ibanUnknownFor(db: DbOrTx, contactId: string, iban: string | null, ownClaimId: string): boolean {
  if (!iban) return false;
  const learned = db.select({ id: financeContactBankAccounts.id }).from(financeContactBankAccounts).where(and(eq(financeContactBankAccounts.contactId, contactId), eq(financeContactBankAccounts.iban, iban))).get();
  if (learned) return false;
  const earlier = db.select({ id: financeExpenseClaims.id }).from(financeExpenseClaims).where(and(eq(financeExpenseClaims.contactId, contactId), eq(financeExpenseClaims.iban, iban), ne(financeExpenseClaims.id, ownClaimId))).get();
  return !earlier;
}

/** `finance.approve`: der Antrag für die gemeinsame Detailansicht; der eigene → `expenseOwnClaim`/`expenseSameContact` mit Namen. */
export async function getApproval(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ApprovalView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, claimIdSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadClaim(deps, parsed.value.claimId);
  if (!loaded.ok) return loaded;
  const own = ownClaimProblem(deps, ctx, loaded.value);
  if (own) return own;
  const view = expenseClaimViewInternal(deps, deps.db, loaded.value.id)!;
  const ibanUnknown = ibanUnknownFor(deps.db, view.contactId, view.iban, view.id);
  if (hasPermission(ctx, 'finance.read')) return ok({ ...view, receiptsVisible: true, ibanUnknown });
  return ok({
    ...view,
    iban: null,
    waiverDeclarationDocumentId: null,
    waiverSignedDocumentId: null,
    positions: view.positions.map((p) => ({ ...p, documentId: null })),
    receiptsVisible: false,
    ibanUnknown,
  });
}

// ── Prüfliste des Verzichts ─────────────────────────────────────────────────

const checksSchema = z.object({ claimId: z.string().min(1), declaredOn: z.string().date().optional(), claimAgreedConfirmed: z.boolean().optional() });

/** `finance.approve`: die vier Prüfungen des Verzichts für die `RequirementList` (Annahme 9). */
export async function waiverChecks(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<WaiverCheck[]>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, checksSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadClaim(deps, parsed.value.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  if (!claim.waiver) return invalid([{ path: 'claimId', message: 'notAWaiverClaim' }]);
  const at = { declaredOn: parsed.value.declaredOn ?? claim.waiverDeclaredOn ?? today(deps), claimAgreedConfirmed: parsed.value.claimAgreedConfirmed ?? claim.claimAgreedConfirmed };
  return ok(evaluateWaiverInternal(deps.db, claim, positionsOf(deps.db, claim.id), at).checks);
}

// ── Freigeben ───────────────────────────────────────────────────────────────

const approveSchema = z.object({
  claimId: z.string().min(1),
  expectedVersion: expectedVersionField,
  positions: z.array(z.object({ positionId: z.string().min(1), categoryId: z.string().min(1), purposeId: z.string().min(1).nullable().optional() })).max(100),
  waiver: z
    .object({
      claimAgreedConfirmed: z.boolean(),
      declaredOn: z.string().date(),
      /** Begründung für einen späten Verzicht oder eine Vereinbarung nach der frühesten Position — steht am Antrag, nie im Protokoll. */
      lateReason: z.string().trim().max(1000).optional(),
    })
    .optional(),
});

interface Decision {
  positionId: string;
  categoryId: string;
  purposeId: string | null;
}

/** Je Position eine Ausgabe-Kategorie (Annahme 8); „bezahlt aus“ ist optional. */
function decisionsFor(deps: Deps, positions: readonly FinanceExpensePositionRow[], input: z.infer<typeof approveSchema>['positions']): Result<{ decisions: Decision[]; categories: Map<string, FinanceCategoryRow> }> {
  const known = new Set(positions.map((p) => p.id));
  const issues: ValidationIssue[] = [];
  input.forEach((d, i) => {
    if (!known.has(d.positionId)) issues.push({ path: `positions.${i}.positionId`, message: 'unknownPosition' });
  });
  if (issues.length > 0) return invalid(issues);

  const byPosition = new Map(input.map((d) => [d.positionId, d]));
  const missing = positions.findIndex((p) => !byPosition.has(p.id));
  if (missing >= 0) return financeConflict('expenseCategoryRequired', { position: missing + 1 });

  const categories = new Map<string, FinanceCategoryRow>();
  input.forEach((d, i) => {
    const category = deps.db.select().from(financeCategories).where(eq(financeCategories.id, d.categoryId)).get();
    if (!category || category.direction !== 'expense' || !category.isActive) issues.push({ path: `positions.${i}.categoryId`, message: 'notAnExpenseCategory' });
    else categories.set(category.id, category);
  });
  if (issues.length > 0) return invalid(issues);
  for (const d of input) {
    if (d.purposeId && !deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, d.purposeId)).get()) return notFound('financePurpose', d.purposeId);
  }
  return ok({ decisions: positions.map((p) => ({ positionId: p.id, categoryId: byPosition.get(p.id)!.categoryId, purposeId: byPosition.get(p.id)!.purposeId ?? null })), categories });
}

/** Die Einnahme-Kategorie der Aufwandsspende: `expense-waivers` des Startplans, sonst die erste aktive der Art. */
function waiverCategory(db: DbOrTx): FinanceCategoryRow | null {
  const rows = db.select().from(financeCategories).where(and(eq(financeCategories.incomeKind, 'expenseWaiver'), eq(financeCategories.isActive, true))).all();
  return rows.find((c) => c.key === 'expense-waivers') ?? rows[0] ?? null;
}

/**
 * Freigeben (`finance.approve`, **humanOnly**). Ohne Verzicht entsteht die
 * offene Zahlung an die antragstellende Person (Zahlungsreferenz = Nummer,
 * Zeilenvorlage aus den Positionen, Herkunft `financeExpenseClaim`); die
 * Belege bleiben am Antrag (Annahme 8, kein Doppel-Link). Mit Verzicht nach
 * den vier Prüfungen die Aufwandsspende als Buchung ohne Geldzeile, datiert
 * auf den Verzichtstag, belegt mit den Belegen und der Verzichtserklärung.
 * `state` verlässt `submitted` genau einmal — zwei gleichzeitige Freigaben
 * ergeben einen Posten, die zweite `expenseNotSubmitted` (Review Focus 2).
 */
export async function approveExpenseClaim(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, approveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = loadClaim(deps, v.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  const own = ownClaimProblem(deps, ctx, claim);
  if (own) return own;
  if (claim.state !== 'submitted') return financeConflict('expenseNotSubmitted');
  const stale = staleVersion(v.expectedVersion, claim.updatedAt);
  if (stale) return stale;

  const positions = positionsOf(deps.db, claim.id);
  const decided = decisionsFor(deps, positions, v.positions);
  if (!decided.ok) return decided;
  const { decisions, categories } = decided.value;
  const totalCents = sumCents(positions);
  const approvedOn = today(deps);

  let waiver: { declaredOn: string; reason: string | null; freeCents: number; categoryId: string } | null = null;
  if (!claim.waiver && v.waiver) return invalid([{ path: 'waiver', message: 'notAWaiverClaim' }]);
  if (claim.waiver) {
    if (!waiversEnabled(deps)) return financeConflict('expenseWaiversDisabled');
    // Befund 8, Sicherheitsnetz für Altbestände: die Grundlage steht schon auf dem Antrag (seit dem Einreichen) — ohne sie keine Freigabe.
    if (!claim.waiverBasisText) return financeConflict('waiverBasisMissing');
    if (!v.waiver) return invalid([{ path: 'waiver', message: 'required' }]);
    if (v.waiver.declaredOn > approvedOn) return invalid([{ path: 'waiver.declaredOn', message: 'inFuture' }]);
    const reason = v.waiver.lateReason ? v.waiver.lateReason : null;
    const evaluation = evaluateWaiverInternal(deps.db, claim, positions, { declaredOn: v.waiver.declaredOn, claimAgreedConfirmed: v.waiver.claimAgreedConfirmed });
    if (!v.waiver.claimAgreedConfirmed) return financeConflict('waiverNotConfirmed');
    if (evaluation.agreedAfterPosition && !reason) return financeConflict('waiverAgreedAfterPosition');
    if (evaluation.late && !reason) return financeConflict('waiverLateNeedsReason');
    if (evaluation.freeCents < totalCents) return financeConflict('waiverFundsInsufficient', { date: v.waiver.declaredOn, free: formatEuro(evaluation.freeCents), amount: formatEuro(totalCents) });
    if (!claim.waiverDeclarationDocumentId) return financeConflict('waiverDeclarationMissing');
    const category = waiverCategory(deps.db);
    if (!category) return financeConflict('expenseWaiverCategoryMissing');
    waiver = { declaredOn: v.waiver.declaredOn, reason, freeCents: evaluation.freeCents, categoryId: category.id };
  }

  const byId = new Map(positions.map((p) => [p.id, p]));
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const current = tx.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.id, claim.id)).get()!;
      if (current.state !== 'submitted') abort(financeConflict('expenseNotSubmitted'));

      // Erst die Positionen — danach friert der Trigger Kategorie und Zweck ein.
      for (const d of decisions) {
        const p = byId.get(d.positionId)!;
        tx.update(financeExpensePositions).set({ categoryId: d.categoryId, purposeId: d.purposeId }).where(eq(financeExpensePositions.id, p.id)).run();
        financeAudit(tx, deps, ctx, { action: 'finance.expensePosition.categorize', entity: 'financeExpensePosition', id: p.id, after: { claimId: claim.id, categoryId: d.categoryId, purposeId: d.purposeId, projectId: p.projectId }, summary: `Position ${p.sortOrder + 1} des Antrags ${claim.number} zugeordnet` });
      }

      let openItemId: string | null = null;
      let entryId: string | null = null;
      if (!waiver) {
        const item = createOpenItemInternal(tx, deps, ctx, {
          kind: 'payable',
          itemDate: approvedOn,
          contactId: claim.contactId,
          amountCents: totalCents,
          dueOn: addDays(approvedOn, PAYABLE_DUE_DAYS),
          documentId: null,
          originType: 'financeExpenseClaim',
          originId: claim.id,
          paymentReference: claim.number,
          lineTemplate: decisions.map((d) => {
            const p = byId.get(d.positionId)!;
            return { categoryId: d.categoryId, amountCents: -p.amountCents, taxCode: categories.get(d.categoryId)!.defaultTaxCode, projectId: p.projectId, purposeId: d.purposeId };
          }),
        });
        openItemId = item.id;
      } else {
        const w = waiver;
        const lines = resolveEntryLines(deps, {
          entryDate: w.declaredOn,
          text: `Aufwandsspende ${claim.number}`,
          moneyLines: [],
          allocationLines: [
            ...decisions.map((d) => ({ categoryId: d.categoryId, amountCents: -byId.get(d.positionId)!.amountCents, projectId: byId.get(d.positionId)!.projectId, purposeId: d.purposeId })),
            { categoryId: w.categoryId, amountCents: totalCents, contactId: claim.contactId },
          ],
        });
        if (!lines.ok) abort(lines);
        const voucherIds = [...new Set([...positions.map((p) => p.documentId), current.waiverDeclarationDocumentId, current.waiverSignedDocumentId].filter((id): id is string => !!id))];
        const booked = bookEntryInternal(tx, deps, ctx, {
          entryDate: w.declaredOn,
          text: `Aufwandsspende ${claim.number}`,
          lines: (lines as Extract<typeof lines, { ok: true }>).value,
          beforeFinalize: (newEntryId) => {
            for (const documentId of voucherIds) {
              const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
              if (!doc) continue;
              writeVoucherLink(tx, deps, ctx, { entryId: newEntryId, documentId: doc.id, documentNumber: doc.number ?? '', documentChecksum: doc.fileChecksum, viaUpload: false });
              linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeEntry', entityId: newEntryId });
            }
          },
        });
        if (!booked.ok) abort(booked);
        entryId = (booked as Extract<typeof booked, { ok: true }>).value.id;
      }

      const approvedAt = isoNow(deps.clock);
      const changed = tx
        .update(financeExpenseClaims)
        .set({
          state: 'approved',
          approvedAt,
          approvedByUserId: ctx.userId,
          openItemId,
          entryId,
          ...(waiver ? { claimAgreedConfirmed: true, waiverDeclaredOn: waiver.declaredOn, waiverLateReason: waiver.reason, waiverFreeFundsCents: waiver.freeCents } : {}),
          updatedAt: nextVersion(deps, current.updatedAt),
        })
        .where(and(eq(financeExpenseClaims.id, claim.id), eq(financeExpenseClaims.state, 'submitted')))
        .run().changes;
      if (changed !== 1) abort(financeConflict('expenseNotSubmitted'));

      financeAudit(tx, deps, ctx, {
        action: 'finance.expenseClaim.approve',
        entity: 'financeExpenseClaim',
        id: claim.id,
        before: { state: 'submitted' },
        after: {
          state: 'approved', number: claim.number, positionCount: positions.length, totalCents, waiver: claim.waiver, recurring: claim.recurring, approvedAt,
          ...(openItemId ? { openItemId } : {}), ...(entryId ? { entryId } : {}), ...(waiver ? { waiverFreeFundsCents: waiver.freeCents } : {}), channel: ctx.channel,
        },
        summary: waiver ? `Antrag ${claim.number} freigegeben (Aufwandsspende)` : `Antrag ${claim.number} freigegeben`,
      });
      return ok(expenseClaimViewInternal(deps, tx, claim.id)!);
    });
  } catch (error) {
    if (error instanceof ApprovalAborted) return error.failure;
    throw error;
  }
}

// ── Ablehnen ────────────────────────────────────────────────────────────────

const rejectSchema = z.object({ claimId: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/** Ablehnen (`finance.approve`, nicht humanOnly): der Grund steht am Antrag, im Protokoll nur `rejected`. */
export async function rejectExpenseClaim(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ExpenseClaimView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, rejectSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = loadClaim(deps, parsed.value.claimId);
  if (!loaded.ok) return loaded;
  const claim = loaded.value;
  const own = ownClaimProblem(deps, ctx, claim);
  if (own) return own;
  if (claim.state !== 'submitted') return financeConflict('expenseNotSubmitted');

  return deps.db.transaction((tx: DbOrTx) => {
    const changed = tx
      .update(financeExpenseClaims)
      .set({ state: 'rejected', rejectedAt: isoNow(deps.clock), rejectedByUserId: ctx.userId, rejectNote: parsed.value.note, updatedAt: nextVersion(deps, claim.updatedAt) })
      .where(and(eq(financeExpenseClaims.id, claim.id), eq(financeExpenseClaims.state, 'submitted')))
      .run().changes;
    if (changed !== 1) return financeConflict('expenseNotSubmitted');
    financeAudit(tx, deps, ctx, { action: 'finance.expenseClaim.reject', entity: 'financeExpenseClaim', id: claim.id, before: { state: 'submitted' }, after: { state: 'rejected', number: claim.number, rejected: true, channel: ctx.channel }, summary: `Antrag ${claim.number} abgelehnt` });
    return ok(expenseClaimViewInternal(deps, tx, claim.id)!);
  });
}
