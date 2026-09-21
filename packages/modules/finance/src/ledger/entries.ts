import { expectedVersionField, isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, schema, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { unlinkDocumentInternal } from '@kompass/module-dms';
import { projects } from '@kompass/module-projects';
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAccounts, financeAllocationCorrections, financeAllocationLines, financeCategories, financeEntries, financeEntryDocuments, financeEntryJustifications, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePurposes, type FinanceAllocationLineRow, type FinanceEntryRow, type FinanceMoneyLineRow } from '../schema';
import { requireFinanceRead } from './access';
import { TAX_CODES } from './codes';
import { projectFinanceInternal } from './project-settings';
import { taxContextAt, taxOf, type TaxCode, type TaxResult } from './tax';

/** Eine Geldzeile erledigt einen offenen Posten ganz oder teilweise (Spec 5.3). */
export interface MoneyLineSettlementView {
  id: string;
  openItemId: string;
  amountCents: number;
}
export type MoneyLineView = FinanceMoneyLineRow & { settlements: MoneyLineSettlementView[] };
export type AllocationLineView = FinanceAllocationLineRow & {
  /** Nach den Werten des Buchungstags berechnet — nie gespeichert. `null`, wenn dafür kein Satz hinterlegt ist. */
  tax: TaxResult | null;
  /** Es gibt eine angewandte Zuordnungskorrektur (E18). */
  corrected: boolean;
  /** Wartet eine Korrektur auf Freigabe im abgeschlossenen Jahr? */
  pendingCorrectionId: string | null;
};

/** Ein Beleg in der Sicht der Buchung — Nummer und Prüfsumme bleiben auch nach Widerruf oder Grabstein (F2c) stehen. */
export interface VoucherListEntry {
  linkId: string;
  documentId: string | null;
  documentNumber: string;
  documentDeletedAt: string | null;
  addedAt: string;
  revokedAt: string | null;
  replacedByLinkId: string | null;
}

export interface EntryDocumentationState {
  state: 'voucher' | 'statementSuffices' | 'missing';
  warnExpenseAboveLimit: boolean;
}

export interface EntryView extends FinanceEntryRow {
  moneyLines: MoneyLineView[];
  allocationLines: AllocationLineView[];
  /** Σ Geldzeilen − Σ Zuordnungszeilen; 0 = ausgeglichen. „Noch 37,20 € zu verteilen.“ */
  remainderCents: number;
  taxTotals: { outputTaxCents: number; reverseChargeTaxCents: number; inputTaxCents: number; inputTaxMemoCents: number };
  vouchers: VoucherListEntry[];
  documentation: EntryDocumentationState;
  /** Eine unbelegte, festgeschriebene Buchung trägt eine Begründung zum Periodenabschluss (F2c). */
  justified: boolean;
}

/** Zeilen, wie `saveDraft`, `finalize.ts` und `reverse.ts` sie an die Datenbank geben — Vorbelegung ist schon aufgelöst. */
export interface MoneyLineWrite {
  accountId: string;
  amountCents: number;
  rawTransactionId?: string | null;
  /** Fehlt beim Storno (F2a) bewusst: Ein Storno kopiert keine Settlements. */
  settlements?: readonly { openItemId: string; amountCents: number }[];
}
export interface AllocationLineWrite {
  categoryId: string;
  amountCents: number;
  taxCode: TaxCode;
  rateKind: 'standard' | 'reduced';
  projectId: string | null;
  purposeId: string | null;
  contactId: string | null;
  abroad: boolean;
  originLineId: string | null;
  addsToAssets: boolean;
}

const settlementInputSchema = z.object({ openItemId: z.string().min(1), amountCents: z.number().int().positive() });

const moneyLineSchema = z.object({
  accountId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, 'amountCentsRequired'),
  settlements: z.array(settlementInputSchema).optional(),
});

const allocationLineSchema = z.object({
  categoryId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, 'amountCentsRequired'),
  taxCode: z.enum(TAX_CODES).optional(),
  rateKind: z.enum(['standard', 'reduced']).optional(),
  projectId: z.string().min(1).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  abroad: z.boolean().optional(),
  originLineId: z.string().min(1).nullable().optional(),
  addsToAssets: z.boolean().optional(),
});

/** Auch von `bookEntry` (finalize.ts) benutzt — dort ohne `id`/`expectedVersion`. */
export const entryLinesSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  entryDate: z.string().date(),
  text: z.string().trim().min(1).max(300),
  moneyLines: z.array(moneyLineSchema),
  allocationLines: z.array(allocationLineSchema),
});
export type EntryLinesInput = z.infer<typeof entryLinesSchema>;

const idSchema = z.object({ id: z.string().min(1) });

const reviewSchema = z.object({ id: z.string().min(1), reviewed: z.boolean(), expectedVersion: expectedVersionField });

const listSchema = z.object({
  status: z.enum(['draft', 'final']).optional(),
  fiscalYearId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Für `finalize.ts` und `reverse.ts`: Zeilen einer Buchung als Ganzes ersetzen, solange ihr Kopf `draft` ist. */
export function writeLinesInternal(tx: DbOrTx, entryId: string, lines: { moneyLines: readonly MoneyLineWrite[]; allocationLines: readonly AllocationLineWrite[] }): void {
  // Alte Settlements zuerst: Der Fremdschlüssel auf die Geldzeile verbietet sonst deren Löschen.
  const oldMoneyLineIds = tx.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all().map((r) => r.id);
  if (oldMoneyLineIds.length > 0) tx.delete(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, oldMoneyLineIds)).run();
  tx.delete(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).run();
  tx.delete(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).run();
  lines.moneyLines.forEach((line, position) => {
    const id = newId();
    tx.insert(financeMoneyLines).values({ id, entryId, position, accountId: line.accountId, amountCents: line.amountCents, rawTransactionId: line.rawTransactionId ?? null, rawReleasedAt: null }).run();
    for (const settlement of line.settlements ?? []) {
      tx.insert(financeOpenItemSettlements).values({ id: newId(), moneyLineId: id, openItemId: settlement.openItemId, amountCents: settlement.amountCents }).run();
    }
  });
  lines.allocationLines.forEach((line, position) => {
    tx.insert(financeAllocationLines)
      .values({
        id: newId(),
        entryId,
        position,
        categoryId: line.categoryId,
        amountCents: line.amountCents,
        taxCode: line.taxCode,
        rateKind: line.rateKind,
        projectId: line.projectId,
        purposeId: line.purposeId,
        contactId: line.contactId,
        abroad: line.abroad,
        originLineId: line.originLineId,
        addsToAssets: line.addsToAssets,
      })
      .run();
  });
}

const EMPTY_TAX_TOTALS = { outputTaxCents: 0, reverseChargeTaxCents: 0, inputTaxCents: 0, inputTaxMemoCents: 0 };

/**
 * Direkt gelesen, ohne `deps`: `entryViewInternal` kennt nur `db`, nicht die
 * volle `Deps` (es wird auch mit einer offenen Transaktion aufgerufen). Der
 * Vorgabewert 0 stimmt mit dem Vorgabewert der Einstellung überein.
 */
function statementSufficesBelowCentsInternal(db: DbOrTx): number {
  const row = db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'finance.statementSufficesBelowCents')).get();
  return row ? (JSON.parse(row.value) as number) : 0;
}

/**
 * Belegt (Spec 5.2): ein nicht widerrufener Beleg — oder, wenn keine Geldzeile
 * auf einem Barkonto liegt, alle betroffenen Kategorien tragen „Auszug genügt“
 * **und** eine Geldzeile hat einen Rohumsatz. Eine Umbuchung ohne
 * Zuordnungszeilen erfüllt „alle Kategorien“ leer und damit trivial.
 */
export function documentationOf(db: DbOrTx, entryId: string, settings: { statementSufficesBelowCents: number }): EntryDocumentationState {
  const voucherRows = db.select({ documentId: financeEntryDocuments.documentId, revokedAt: financeEntryDocuments.revokedAt }).from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entryId)).all();
  if (voucherRows.some((v) => v.revokedAt === null)) return { state: 'voucher', warnExpenseAboveLimit: false };

  const moneyLines = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entryId)).all();
  const accounts = accountsById(db, moneyLines.map((l) => l.accountId));
  const hasCash = [...accounts.values()].some((a) => a.kind === 'cash');
  if (hasCash) return { state: 'missing', warnExpenseAboveLimit: false };

  const allocationLines = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).all();
  const categories = categoriesById(db, allocationLines.map((l) => l.categoryId));
  const allSuffice = allocationLines.every((l) => categories.get(l.categoryId)?.statementSuffices === true);
  const hasRaw = moneyLines.some((l) => l.rawTransactionId !== null);
  if (!allSuffice || !hasRaw) return { state: 'missing', warnExpenseAboveLimit: false };

  const limit = settings.statementSufficesBelowCents;
  const warn = limit > 0 && allocationLines.some((l) => l.amountCents < 0 && Math.abs(l.amountCents) > limit);
  return { state: 'statementSuffices', warnExpenseAboveLimit: warn };
}

export function entryViewInternal(db: DbOrTx, id: string): EntryView | null {
  const row = db.select().from(financeEntries).where(eq(financeEntries.id, id)).get();
  if (!row) return null;
  const moneyLineRows = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, id)).orderBy(asc(financeMoneyLines.position)).all();
  const settlementRows = moneyLineRows.length > 0 ? db.select().from(financeOpenItemSettlements).where(inArray(financeOpenItemSettlements.moneyLineId, moneyLineRows.map((l) => l.id))).all() : [];
  const moneyLines: MoneyLineView[] = moneyLineRows.map((l) => ({ ...l, settlements: settlementRows.filter((s) => s.moneyLineId === l.id).map((s) => ({ id: s.id, openItemId: s.openItemId, amountCents: s.amountCents })) }));
  const allocationLineRows = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, id)).orderBy(asc(financeAllocationLines.position)).all();
  const moneySum = moneyLines.reduce((s, l) => s + l.amountCents, 0);
  const allocationSum = allocationLineRows.reduce((s, l) => s + l.amountCents, 0);

  // Immer berechnet, nie gespeichert (Spec 5.2): eine nachträglich richtig datierte Besteuerungsform macht alte Buchungen richtig.
  const context = taxContextAt(db, row.entryDate);
  const categories = categoriesById(db, allocationLineRows.map((l) => l.categoryId));
  const correctionRows =
    allocationLineRows.length > 0
      ? db.select({ lineId: financeAllocationCorrections.lineId, state: financeAllocationCorrections.state, id: financeAllocationCorrections.id }).from(financeAllocationCorrections).where(inArray(financeAllocationCorrections.lineId, allocationLineRows.map((l) => l.id))).all()
      : [];
  const allocationLines: AllocationLineView[] = allocationLineRows.map((l) => {
    const own = correctionRows.filter((c) => c.lineId === l.id);
    return {
      ...l,
      tax: context ? taxOf({ amountCents: l.amountCents, taxCode: l.taxCode as TaxCode, rateKind: l.rateKind as 'standard' | 'reduced', taxation: context.taxation, inputTaxDeductible: categories.get(l.categoryId)?.inputTaxDeductible ?? 'no', rates: context.rates }) : null,
      corrected: own.some((c) => c.state === 'applied'),
      pendingCorrectionId: own.find((c) => c.state === 'pending')?.id ?? null,
    };
  });
  const taxTotals = allocationLines.reduce((acc, l) => {
    if (!l.tax) return acc;
    return { outputTaxCents: acc.outputTaxCents + l.tax.outputTaxCents, reverseChargeTaxCents: acc.reverseChargeTaxCents + l.tax.reverseChargeTaxCents, inputTaxCents: acc.inputTaxCents + l.tax.inputTaxCents, inputTaxMemoCents: acc.inputTaxMemoCents + l.tax.inputTaxMemoCents };
  }, EMPTY_TAX_TOTALS);

  const voucherRows = db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, id)).all();
  const vouchers: VoucherListEntry[] = voucherRows.map((v) => ({ linkId: v.id, documentId: v.documentId, documentNumber: v.documentNumber, documentDeletedAt: v.documentDeletedAt, addedAt: v.addedAt, revokedAt: v.revokedAt, replacedByLinkId: v.replacedByLinkId }));
  const documentation = documentationOf(db, id, { statementSufficesBelowCents: statementSufficesBelowCentsInternal(db) });
  const justified = !!db.select({ entryId: financeEntryJustifications.entryId }).from(financeEntryJustifications).where(eq(financeEntryJustifications.entryId, id)).get();

  return { ...row, moneyLines, allocationLines, remainderCents: moneySum - allocationSum, taxTotals, vouchers, documentation, justified };
}

/** Nur Nummern und Zähler — nie Text, nie Kontakt (Spec 10.3). */
function auditSnapshot(view: EntryView, ctx: CallContext): Record<string, unknown> {
  const totalCents =
    view.moneyLines.length > 0
      ? view.moneyLines.reduce((s, l) => s + Math.abs(l.amountCents), 0)
      : view.allocationLines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  return {
    status: view.status,
    number: view.number,
    entryDate: view.entryDate,
    fiscalYearId: view.fiscalYearId,
    moneyLineCount: view.moneyLines.length,
    allocationLineCount: view.allocationLines.length,
    totalCents,
    reviewed: view.reviewedAt !== null,
    reversesEntryId: view.reversesEntryId,
    reversedByEntryId: view.reversedByEntryId,
    correctionOfEntryId: view.correctionOfEntryId,
    channel: ctx.channel,
    cashWarning: view.cashWarningReason !== null,
  };
}

function accountsById(db: DbOrTx, ids: readonly string[]) {
  const rows = ids.length > 0 ? db.select().from(financeAccounts).where(inArray(financeAccounts.id, [...new Set(ids)])).all() : [];
  return new Map(rows.map((r) => [r.id, r]));
}

function categoriesById(db: DbOrTx, ids: readonly string[]) {
  const rows = ids.length > 0 ? db.select().from(financeCategories).where(inArray(financeCategories.id, [...new Set(ids)])).all() : [];
  return new Map(rows.map((r) => [r.id, r]));
}

function purposeExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, id)).get();
}

function purposeAbroad(db: DbOrTx, id: string): boolean {
  return db.select({ abroad: financePurposes.abroad }).from(financePurposes).where(eq(financePurposes.id, id)).get()?.abroad ?? false;
}

/** Finanzfelder eines Projekts, nur das Auslands-Flag — vorgabe `false` ohne Zeile (F2c Task 7). */
function projectAbroad(db: DbOrTx, id: string): boolean {
  return projectFinanceInternal(db, id).abroad;
}

function projectExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

function contactExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
}

/**
 * Prüft die Settlements einer Geldzeile (Spec 5.3): Der Posten muss existieren
 * und darf nicht ohne Zahlung erledigt sein, die Summe darf den Betrag der
 * Zeile nicht übersteigen, und die Richtung muss stimmen — eine Verbindlichkeit
 * wird durch eine Ausgabe beglichen, eine Forderung durch eine Einnahme.
 */
function checkSettlements(db: DbOrTx, line: { amountCents: number; settlements?: readonly { openItemId: string; amountCents: number }[] }): Failure | null {
  const settlements = line.settlements ?? [];
  if (settlements.length === 0) return null;
  const sum = settlements.reduce((s, x) => s + x.amountCents, 0);
  if (sum > Math.abs(line.amountCents)) return financeConflict('settlementExceedsLine');
  for (const settlement of settlements) {
    const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, settlement.openItemId)).get();
    if (!item) return notFound('financeOpenItem', settlement.openItemId);
    if (item.cancelledAt !== null) return financeConflict('openItemCancelled');
    if (item.kind === 'payable' && line.amountCents >= 0) return financeConflict('settlementWrongDirection');
    if (item.kind === 'receivable' && line.amountCents <= 0) return financeConflict('settlementWrongDirection');
  }
  return null;
}

/** Prüft, was eine Buchung ansteuert; ansonsten unverändert von `input`. Erst das Festschreiben prüft, ob es auch aktiv ist. */
function checkReferences(deps: Deps, input: EntryLinesInput): Failure | null {
  const accounts = accountsById(deps.db, input.moneyLines.map((l) => l.accountId));
  for (const line of input.moneyLines) {
    if (!accounts.has(line.accountId)) return notFound('financeAccount', line.accountId);
    const settlementProblem = checkSettlements(deps.db, line);
    if (settlementProblem) return settlementProblem;
  }

  const categories = categoriesById(deps.db, input.allocationLines.map((l) => l.categoryId));
  for (const line of input.allocationLines) {
    if (!categories.has(line.categoryId)) return notFound('financeCategory', line.categoryId);
    if (line.contactId && !contactExists(deps.db, line.contactId)) return notFound('contact', line.contactId);
    if (line.projectId && !projectExists(deps.db, line.projectId)) return notFound('project', line.projectId);
    if (line.purposeId && !purposeExists(deps.db, line.purposeId)) return notFound('financePurpose', line.purposeId);
  }
  return null;
}

/** Bargeld wird am selben Tag festgehalten: Ein Entwurf auf einem Barkonto lässt sich nicht parken (Spec 5.4). Nur `saveDraft` fragt das — `bookEntry` ist der Weg dafür. */
function cashLineProblem(deps: Deps, moneyLines: readonly { accountId: string }[]): Failure | null {
  const accounts = accountsById(deps.db, moneyLines.map((l) => l.accountId));
  if ([...accounts.values()].some((a) => a.kind === 'cash')) return financeConflict('cashDraftNotAllowed');
  return null;
}

function resolvedLines(deps: Deps, input: EntryLinesInput): { moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] } {
  const categories = categoriesById(deps.db, input.allocationLines.map((l) => l.categoryId));
  return {
    moneyLines: input.moneyLines.map((l) => ({ accountId: l.accountId, amountCents: l.amountCents, settlements: l.settlements })),
    allocationLines: input.allocationLines.map((l) => {
      const category = categories.get(l.categoryId)!;
      return {
        categoryId: l.categoryId,
        amountCents: l.amountCents,
        taxCode: (l.taxCode ?? category.defaultTaxCode) as TaxCode,
        rateKind: l.rateKind ?? 'standard',
        projectId: l.projectId ?? null,
        purposeId: l.purposeId ?? null,
        contactId: l.contactId ?? null,
        abroad: l.abroad ?? ((l.purposeId ? purposeAbroad(deps.db, l.purposeId) : false) || (l.projectId ? projectAbroad(deps.db, l.projectId) : false)),
        originLineId: l.originLineId ?? null,
        addsToAssets: l.addsToAssets ?? category.incomeKind === 'inheritance',
      };
    }),
  };
}

/** Für `bookEntry` (finalize.ts): dieselbe Prüfung und Vorbelegung wie `saveDraft`, ohne die Bargeld-Sperre — Bargeld bucht `bookEntry` gerade deshalb in einem Zug. */
export function resolveEntryLines(deps: Deps, input: EntryLinesInput): Result<{ moneyLines: MoneyLineWrite[]; allocationLines: AllocationLineWrite[] }> {
  const problem = checkReferences(deps, input);
  if (problem) return problem;
  return ok(resolvedLines(deps, input));
}

/** `finance.entriesWrite`: Entwurf anlegen (ohne `id`) oder als Ganzes ersetzen (mit `id`). Ein Entwurf darf unausgeglichen und leer sein. */
export async function saveDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, entryLinesSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  let before: EntryView | null = null;
  if (v.id) {
    before = entryViewInternal(deps.db, v.id);
    if (!before) return notFound('financeEntry', v.id);
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
    if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });
  }

  const cashProblem = cashLineProblem(deps, v.moneyLines);
  if (cashProblem) return cashProblem;
  const resolved = resolveEntryLines(deps, v);
  if (!resolved.ok) return resolved;
  const lines = resolved.value;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    if (before) {
      tx.update(financeEntries)
        .set({ entryDate: v.entryDate, text: v.text, reviewedAt: null, reviewedByUserId: null, updatedAt: now })
        .where(eq(financeEntries.id, id))
        .run();
    } else {
      tx.insert(financeEntries)
        .values({ id, number: null, entryDate: v.entryDate, text: v.text, status: 'draft', createdByUserId: ctx.userId ?? 'system', createdChannel: ctx.channel, createdAt: now, updatedAt: now })
        .run();
    }
    writeLinesInternal(tx, id, lines);
    const after = entryViewInternal(tx, id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.entry.draftSave', entity: 'financeEntry', id, after: auditSnapshot(after, ctx), summary: `Buchungsentwurf ${id} gespeichert` });
    return ok(after);
  });
}

/** `finance.read`: eine Buchung tritt mit Text und Kontakt auf — Übersicht genügt nicht (Spec 10.1). */
export async function getEntry(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const view = entryViewInternal(deps.db, parsed.value.id);
  if (!view) return notFound('financeEntry', parsed.value.id);
  return ok(view);
}

export async function listEntries(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entries: EntryView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;

  const conditions: SQL[] = [];
  if (f.status) conditions.push(eq(financeEntries.status, f.status));
  if (f.fiscalYearId) conditions.push(eq(financeEntries.fiscalYearId, f.fiscalYearId));
  if (f.from) conditions.push(gte(financeEntries.entryDate, f.from));
  if (f.to) conditions.push(lte(financeEntries.entryDate, f.to));
  if (f.accountId) {
    const ids = deps.db.select({ id: financeMoneyLines.entryId }).from(financeMoneyLines).where(eq(financeMoneyLines.accountId, f.accountId)).all().map((r) => r.id);
    conditions.push(inArray(financeEntries.id, ids.length > 0 ? ids : ['—']));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const allIds = deps.db.select({ id: financeEntries.id }).from(financeEntries).where(where).orderBy(desc(financeEntries.entryDate), desc(financeEntries.createdAt)).all().map((r) => r.id);
  const total = allIds.length;
  const entries = allIds.slice(f.offset, f.offset + f.limit).map((id) => entryViewInternal(deps.db, id)!);
  return ok({ entries, total });
}

/** `finance.entriesWrite`: ein Entwurf wird gelöscht, nicht storniert (Spec 5.4). */
export async function deleteDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });

  return deps.db.transaction((tx: DbOrTx) => {
    // Belegzeilen gehen mit dem Entwurf; der Bezug in der Akte wird gelöst, das Dokument selbst bleibt dort liegen.
    const voucherLinks = tx.select({ documentId: financeEntryDocuments.documentId }).from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, before.id)).all();
    for (const link of voucherLinks) {
      if (link.documentId) unlinkDocumentInternal(tx, { documentId: link.documentId, entityType: 'financeEntry', entityId: before.id });
    }
    tx.delete(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, before.id)).run();
    tx.delete(financeAllocationLines).where(eq(financeAllocationLines.entryId, before.id)).run();
    tx.delete(financeMoneyLines).where(eq(financeMoneyLines.entryId, before.id)).run();
    tx.delete(financeEntries).where(eq(financeEntries.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.entry.draftDelete', entity: 'financeEntry', id: before.id, before: auditSnapshot(before, ctx), summary: `Buchungsentwurf ${before.id} gelöscht` });
    return ok({ id: before.id });
  });
}

/**
 * `finance.entriesWrite`, **`humanOnly`**: Ein Mensch bestätigt den Entwurf.
 * Ein Agent bereitet vor, ein Mensch prüft — über MCP verweigert, bis der
 * Verein `finance.mcpHumanOnlyAllowed` an der Oberfläche gesetzt hat (E10).
 */
export async function setReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EntryView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reviewSchema, input);
  if (!parsed.ok) return parsed;
  const before = entryViewInternal(deps.db, parsed.value.id);
  if (!before) return notFound('financeEntry', parsed.value.id);
  if (before.status !== 'draft') return financeConflict('entryNotDraft', { number: before.number ?? before.id });
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeEntries)
      .set({ reviewedAt: parsed.value.reviewed ? now : null, reviewedByUserId: parsed.value.reviewed ? ctx.userId : null, updatedAt: now })
      .where(eq(financeEntries.id, before.id))
      .run();
    const after = entryViewInternal(tx, before.id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.entry.review', entity: 'financeEntry', id: before.id, after: { ...auditSnapshot(after, ctx), reviewed: parsed.value.reviewed }, summary: `Buchungsentwurf ${before.id} ${parsed.value.reviewed ? 'geprüft' : 'Prüfung zurückgenommen'}` });
    return ok(after);
  });
}
