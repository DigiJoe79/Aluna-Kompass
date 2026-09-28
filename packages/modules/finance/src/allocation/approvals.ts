import { combineConflicts, yearIn, expectedVersionField, hasPermission, invalid, isoNow, notFound, ok, readSetting, requirePermission, schema, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result, type ValidationIssue } from '@kompass/core';
import { contactIdForUserInternal, contacts, displayName } from '@kompass/module-contacts';
import { documents, linkDocumentInternal } from '@kompass/module-dms';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { resolveEntryLines } from '../ledger/entries';
import { bookEntryInternal } from '../ledger/finalize';
import { purposeGoingNegative } from '../ledger/purpose-negative';
import { createOpenItemInternal } from '../ledger/open-items';
import { writeVoucherLink } from '../ledger/vouchers';
import { financeCategories, financeContactBankAccounts, financeExpenseClaims, financeExpensePositions, financePartnerPaymentCounters, financePartnerPayments, financePartnerProfiles, financePurposeTransfers, financePurposes, type FinanceCategoryRow, type FinanceExpenseClaimRow, type FinanceExpensePositionRow, type FinancePartnerPaymentRow } from '../schema';
import { expenseClaimViewInternal, nextVersion, positionsOf, sumCents, waiversEnabled, type ExpenseClaimView } from './expenses';
import { evaluateWaiverInternal, type WaiverCheck } from './waiver';
import { noticeReasonNeeded, overdueReasonNeeded, ownPaymentProblem, paidLineViewsOf, partnerPaymentViewInternal, positionViewsOf, purposeOutflowsOf, sumPositionCents } from './partner-payments';

/**
 * Die Freigabe einer Auslage (F8a Task 3, Spec 8.2): Warteschlange, Detail,
 * freigeben, ablehnen, die Prüfliste des Verzichts. Alles unter
 * `finance.approve` — **nie für eigene Anträge** (Spec 10.1): Freigebender ≠
 * Anleger und sein Kontakt ≠ Antragsteller. Die Freigabe legt den offenen
 * Posten bzw. die Buchung der Aufwandsspende im Namen des Vorgangs an; sie
 * braucht dafür kein Buchungsrecht. Ins Protokoll kommen Zustand, Nummer,
 * Beträge, IDs — nie Ablehnungsgrund, Begründung, IBAN.
 */


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

export type ApprovalQueueItem =
  | { kind: 'expenseClaim'; claimId: string; number: string; contactName: string; totalCents: number; submittedAt: string; waiver: boolean }
  | { kind: 'partnerPayment'; paymentId: string; partnerName: string; totalCents: number; submittedAt: string; basis: string }
  | { kind: 'purposeTransfer'; transferId: string; number: string; fromName: string | null; toName: string | null; amountCents: number; submittedAt: string };

const listSchema = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) });

/**
 * Annahme 6/7: die eingereichten Anträge **und** die eingereichten Zahlungen
 * an Partner, erst vereint, dann sortiert (älteste zuerst) und erst danach
 * geschnitten (Fassung 2 — nicht je Art einzeln geschnitten) — ohne die vom
 * Betrachter angelegten. Ohne IBAN.
 */
export async function listApprovals(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: ApprovalQueueItem[]; total: number }>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const ownContact = ctx.userId ? contactIdForUserInternal(deps.db, ctx.userId) : null;
  const claimRows = deps.db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.state, 'submitted')).all().filter((c) => c.submittedByUserId !== ctx.userId && c.contactId !== ownContact);
  const claimItems: (ApprovalQueueItem & { submittedAt: string })[] = claimRows.map((c) => {
    const view = expenseClaimViewInternal(deps, deps.db, c.id)!;
    return { kind: 'expenseClaim', claimId: c.id, number: c.number!, contactName: view.contactName, totalCents: view.totalCents, submittedAt: c.submittedAt!, waiver: c.waiver };
  });

  const paymentRows = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.state, 'submitted')).all().filter((p) => p.createdByUserId !== ctx.userId);
  const paymentItems: (ApprovalQueueItem & { submittedAt: string })[] = paymentRows.map((p) => {
    const partner = deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get()!;
    const contact = deps.db.select().from(contacts).where(eq(contacts.id, partner.contactId)).get()!;
    return { kind: 'partnerPayment', paymentId: p.id, partnerName: displayName(contact), totalCents: sumPositionCents(positionViewsOf(deps.db, p.id)), submittedAt: p.submittedAt!, basis: p.basis };
  });

  const transferRows = deps.db.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.state, 'submitted')).all().filter((t) => t.createdByUserId !== ctx.userId);
  const transferItems: (ApprovalQueueItem & { submittedAt: string })[] = transferRows.map((t) => {
    const from = t.fromPurposeId ? deps.db.select({ name: financePurposes.name }).from(financePurposes).where(eq(financePurposes.id, t.fromPurposeId)).get() : null;
    const to = t.toPurposeId ? deps.db.select({ name: financePurposes.name }).from(financePurposes).where(eq(financePurposes.id, t.toPurposeId)).get() : null;
    return { kind: 'purposeTransfer', transferId: t.id, number: t.number, fromName: from?.name ?? null, toName: to?.name ?? null, amountCents: t.amountCents, submittedAt: t.createdAt };
  });

  // F8b Annahme 5, Fassung 2: alle drei Arten erst vereinen, dann sortieren (älteste zuerst), erst danach schneiden.
  const all = [...claimItems, ...paymentItems, ...transferItems].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const items = all.slice(parsed.value.offset, parsed.value.offset + parsed.value.limit);
  return ok({ items, total: all.length });
}

// ── Detail ──────────────────────────────────────────────────────────────────

const claimIdSchema = z.object({ claimId: z.string().min(1) });

export interface ApprovalView extends ExpenseClaimView {
  /** Mit `finance.read`: volle IBAN und Belege. Ohne: maskierte IBAN, keine Dokument-IDs (Annahme 6). */
  receiptsVisible: boolean;
  /** Befund 4: weder für den Kontakt gelernt noch in einem früheren Antrag verwendet — ein Hinweis, keine Sperre. */
  ibanUnknown: boolean;
  /** Befund 35: die IBAN ist einem anderen Kontakt zugeordnet — ein Hinweis ohne Namen, keine Sperre. */
  ibanBelongsToOtherContact: boolean;
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
  const ibanBelongsToOtherContact = view.warnings.includes('ibanBelongsToOtherContact');
  if (hasPermission(ctx, 'finance.read')) return ok({ ...view, receiptsVisible: true, ibanUnknown, ibanBelongsToOtherContact });
  return ok({
    ...view,
    iban: null,
    waiverDeclarationDocumentId: null,
    waiverSignedDocumentId: null,
    positions: view.positions.map((p) => ({ ...p, documentId: null })),
    receiptsVisible: false,
    ibanUnknown,
    ibanBelongsToOtherContact,
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
  const at = { declaredOn: parsed.value.declaredOn ?? claim.waiverDeclaredOn ?? todayIn(deps), claimAgreedConfirmed: parsed.value.claimAgreedConfirmed ?? claim.claimAgreedConfirmed };
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
  /** Q Rest: Begründung, wenn „bezahlt aus“ einen Zweck ins Minus bringt (`purposeGoesNegative`) — steht am Antrag bzw. an der Buchung, nie im Protokoll. */
  purposeReason: z.string().trim().max(1000).optional(),
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
  // N6: fehlende Voraussetzungen werden gesammelt und zusammen gemeldet — eine fehlende Kategorie zählt mit.
  const problems: Failure[] = [];
  if (!decided.ok) {
    if (decided.error.type !== 'conflict') return decided;
    problems.push(decided);
  }
  const totalCents = sumCents(positions);
  const approvedOn = todayIn(deps);

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
    // Prüfer-Fixrunde 28.09.: Ist die Grundlage jünger als die Aufwendung, hilft kein Häkchen — dann nur dieser Grund.
    if (!v.waiver.claimAgreedConfirmed && !evaluation.agreedAfterPosition) problems.push(financeConflict('waiverNotConfirmed'));
    if (evaluation.agreedAfterPosition) problems.push(financeConflict('waiverAgreedAfterPosition')); // J Rest: keine Begründung als Ausweg
    if (evaluation.late && !reason) problems.push(financeConflict('waiverLateNeedsReason'));
    if (evaluation.freeCents < totalCents) problems.push(financeConflict('waiverFundsInsufficient', { date: v.waiver.declaredOn, free: evaluation.freeCents, amount: totalCents }));
    if (!claim.waiverDeclarationDocumentId) problems.push(financeConflict('waiverDeclarationMissing'));
    if (!claim.waiverSignedDocumentId) problems.push(financeConflict('waiverSignedMissing'));
    const category = waiverCategory(deps.db);
    if (!category) problems.push(financeConflict('expenseWaiverCategoryMissing'));
    if (problems.length === 0) waiver = { declaredOn: v.waiver.declaredOn, reason, freeCents: evaluation.freeCents, categoryId: category!.id };
  }
  // Q Rest (Recheck sha-0170e73): Die Freigabe entnimmt dem Zweck das Geld (Posten oder Buchung) — wie beim Festschreiben mit Pflichtbegründung.
  let purposeNegativeReason: string | null = null;
  if (decided.ok) {
    const outflows = decided.value.decisions.map((d) => ({ purposeId: d.purposeId, amountCents: -positions.find((p) => p.id === d.positionId)!.amountCents }));
    const negative = purposeGoingNegative(deps.db, outflows);
    if (negative && !v.purposeReason) problems.unshift(negative);
    else if (negative) purposeNegativeReason = v.purposeReason!;
  }
  const refused = combineConflicts(problems);
  if (refused) return refused;
  const { decisions, categories } = (decided as Extract<typeof decided, { ok: true }>).value;

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
          purposeNegativeReason,
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
          purposeNegativeReason,
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

// ── Freigabe einer Zahlung an Partner (F7 Task 4) ───────────────────────────

function allocatePartnerPaymentNumber(tx: DbOrTx, year: number): string {
  const counter = tx.select().from(financePartnerPaymentCounters).where(eq(financePartnerPaymentCounters.year, year)).get();
  const next = (counter?.last ?? 0) + 1;
  if (counter) tx.update(financePartnerPaymentCounters).set({ last: next }).where(eq(financePartnerPaymentCounters.year, year)).run();
  else tx.insert(financePartnerPaymentCounters).values({ year, last: next }).run();
  return `PZ-${year}-${String(next).padStart(3, '0')}`;
}

/** Annahme 7, letzter Satz: `foreignBody` oder ein Kontakt im Ausland. */
function partnerAbroad(deps: Deps, partner: { status: string }, contact: { country: string | null }): boolean {
  if (partner.status === 'foreignBody') return true;
  const orgCountry = readSetting<string>(deps, 'organization.country');
  return contact.country !== null && contact.country !== orgCountry;
}

export const approvePaymentSchema = z.object({ id: z.string().min(1), expectedVersion: expectedVersionField, noticeReason: z.string().trim().max(1000).optional(), overdueReason: z.string().trim().max(1000).optional(), purposeReason: z.string().trim().max(1000).optional() });

/**
 * Freigeben (Annahme 7): `finance.approve`, humanOnly, ≠ Anleger. Ohne
 * `retroactive` entsteht die offene Zahlung an den Partner mit der
 * Zeilenvorlage der Positionen (inklusive `abroad`); mit `retroactive` gibt
 * es keinen Posten — der Zahlungstag steht schon aus den Paid-Lines fest.
 * `state` verlässt `submitted` genau einmal (Trigger, Review Focus 2).
 */
export async function approvePartnerPayment(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<import('./partner-payments').PartnerPaymentView>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, approvePaymentSchema, input);
  if (!parsed.ok) return parsed;
  const payment = deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, parsed.value.id)).get();
  if (!payment) return notFound('financePartnerPayment', parsed.value.id);
  if (payment.state !== 'submitted') return financeConflict('partnerPaymentNotSubmitted');
  const own = ownPaymentProblem(ctx, payment);
  if (own) return own;
  const stale = staleVersion(parsed.value.expectedVersion, payment.updatedAt);
  if (stale) return stale;

  const partner = deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, payment.partnerId)).get()!;
  const contact = deps.db.select().from(contacts).where(eq(contacts.id, partner.contactId)).get()!;
  const abroad = partnerAbroad(deps, partner, contact);
  const positions = positionViewsOf(deps.db, payment.id);
  const totalCents = sumPositionCents(positions);
  const approvedOn = todayIn(deps);
  // Annahme 5, Review Focus 5: die Freigabe prüft erneut — der Bescheid kann zwischen Einreichen und Freigeben ablaufen.
  const paymentDate = payment.retroactive ? [...paidLineViewsOf(deps.db, payment.id)].sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0]?.entryDate ?? approvedOn : approvedOn;
  const purposeNegative = payment.retroactive ? null : purposeGoingNegative(deps.db, purposeOutflowsOf(positions));
  // N6: beide Pflichtbegründungen auf einmal nennen, nicht nacheinander.
  const refused = combineConflicts([
    ...(noticeReasonNeeded(deps, partner, paymentDate) && !parsed.value.noticeReason && !payment.noticeReason ? [financeConflict('partnerNoticeReasonRequired')] : []),
    ...(overdueReasonNeeded(deps, partner, payment.id) && !parsed.value.overdueReason && !payment.overdueReason ? [financeConflict('partnerOverdueReasonRequired')] : []),
    // Q Rest: Der Bestand kann sich seit dem Einreichen geändert haben — eine Begründung vom Einreichen genügt.
    ...(purposeNegative && !payment.purposeNegativeReason && !parsed.value.purposeReason ? [purposeNegative] : []),
  ]);
  if (refused) return refused;
  const categories = new Map(deps.db.select().from(financeCategories).all().map((c) => [c.id, c] as const));

  return deps.db.transaction((tx: DbOrTx) => {
    const current = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!;
    if (current.state !== 'submitted') return financeConflict('partnerPaymentNotSubmitted');

    const number = allocatePartnerPaymentNumber(tx, yearIn(deps));
    let openItemId: string | null = null;
    if (!payment.retroactive) {
      const item = createOpenItemInternal(tx, deps, ctx, {
        kind: 'payable',
        itemDate: approvedOn,
        contactId: partner.contactId,
        amountCents: totalCents,
        dueOn: addDays(approvedOn, PAYABLE_DUE_DAYS),
        documentId: null,
        originType: 'financePartnerPayment',
        originId: payment.id,
        paymentReference: number,
        lineTemplate: positions.map((p) => ({ categoryId: p.categoryId, amountCents: -p.amountCents, taxCode: p.categoryId ? categories.get(p.categoryId)?.defaultTaxCode : null, projectId: p.projectId, purposeId: p.purposeId, abroad })),
      });
      openItemId = item.id;
    }
    const changed = tx
      .update(financePartnerPayments)
      .set({
        state: 'approved', number, approvedAt: isoNow(deps.clock), approvedByUserId: ctx.userId ?? 'system', approvedChannel: ctx.channel, openItemId,
        noticeReason: payment.noticeReason ?? parsed.value.noticeReason ?? null, overdueReason: payment.overdueReason ?? parsed.value.overdueReason ?? null,
        purposeNegativeReason: payment.purposeNegativeReason ?? (purposeNegative ? parsed.value.purposeReason ?? null : null),
        updatedAt: nextVersion(deps, current.updatedAt),
      })
      .where(and(eq(financePartnerPayments.id, payment.id), eq(financePartnerPayments.state, 'submitted')))
      .run().changes;
    if (changed !== 1) return financeConflict('partnerPaymentNotSubmitted');
    const after = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, payment.id)).get()!;
    financeAudit(tx, deps, ctx, {
      action: 'finance.partnerPayment.approve', entity: 'financePartnerPayment', id: payment.id,
      before: { state: 'submitted' },
      after: { state: 'approved', number, basis: after.basis, basisOverridden: after.basisOverridden, retroactive: after.retroactive, positionCount: positions.length, totalCents, proofMonths: after.proofMonths, openItemId, channel: ctx.channel },
      summary: `Zahlung an Partner ${number} freigegeben`,
    });
    return ok(partnerPaymentViewInternal(deps, ctx, tx, after));
  });
}
