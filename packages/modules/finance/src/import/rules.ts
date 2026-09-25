import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { requireFinanceRead } from '../ledger/access';
import { TAX_CODES } from '../ledger/codes';
import { isValidIban, normalizeIban } from '../ledger/iban';
import { financeAccounts, financeAllocationLines, financeCategories, financeImportRules, financeImportRuns, financeMoneyLines, financePurposes, financeRawTransactions, type FinanceImportRuleRow } from '../schema';
import { ruleMatches, type RuleConditions, type RuleTarget } from '../rules-pure';

/**
 * Regeln für Kontoumsätze (F5, Spec 6.4 Vorschlag 4; HANDOFF § 12.8): eine
 * Bedingung, ein Ergebnis. Arbeitsmaterial — änderbar, löschbar, und sie
 * wirkt nur nach vorn: Die Vorschau nennt frühere Treffer, bucht sie aber nie
 * um. Name und Textbedingung sind Freitext, die IBAN ein Bankdatum, der
 * Kontakt eine Person — nichts davon kommt ins Protokoll (Spec 10.3).
 */
export interface ImportRuleView extends FinanceImportRuleRow {
  categoryName: string;
  /** Die Kategorie ist stillgelegt — die Regel schlägt weiter vor, aber Übernehmen scheitert (Review Focus 2). */
  categoryInactive: boolean;
  /** Frühere Kontoumsätze (aus nicht verworfenen Auszügen), die die Regel trifft. */
  hitCount: number;
  /** Davon gebucht (Entwurf oder festgeschrieben) mit einer anderen Kategorie. */
  differentlyBookedCount: number;
}

/** Leer oder nur Leerraum heißt „keine Bedingung“. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optionalId = z.string().min(1).nullable().optional().transform((v) => v ?? null);
const optionalCents = z.number().int().min(0).nullable().optional().transform((v) => v ?? null);

const conditionFields = {
  accountId: optionalId,
  direction: z.enum(['in', 'out']).nullable().optional().transform((v) => v ?? null),
  counterpartyIban: optionalText(42),
  textContains: optionalText(120),
  amountMinCents: optionalCents,
  amountMaxCents: optionalCents,
};

function checkConditions(v: RuleConditions, c: z.RefinementCtx): void {
  const any = v.accountId !== null || v.direction !== null || v.counterpartyIban !== null || v.textContains !== null || v.amountMinCents !== null || v.amountMaxCents !== null;
  if (!any) c.addIssue({ code: 'custom', path: [], message: 'ruleNeedsCondition' });
  if (v.counterpartyIban !== null && !isValidIban(v.counterpartyIban)) c.addIssue({ code: 'custom', path: ['counterpartyIban'], message: 'invalidIban' });
  if (v.amountMinCents !== null && v.amountMaxCents !== null && v.amountMinCents > v.amountMaxCents) c.addIssue({ code: 'custom', path: ['amountMaxCents'], message: 'amountRangeReversed' });
}

const saveImportRuleSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    ...conditionFields,
    categoryId: z.string().min(1),
    projectId: optionalId,
    purposeId: optionalId,
    contactId: optionalId,
    taxCode: z.enum(TAX_CODES).nullable().optional().transform((v) => v ?? null),
    entryText: optionalText(300),
  })
  .superRefine(checkConditions);

const previewImportRuleSchema = z.object({ ...conditionFields, categoryId: z.string().min(1) }).superRefine(checkConditions);
const listImportRulesSchema = z.object({ includeInactive: z.boolean().default(false) });
const deleteImportRuleSchema = z.object({ id: z.string().min(1) });

const conditionsOf = (r: RuleConditions): RuleConditions => ({
  accountId: r.accountId, direction: r.direction, counterpartyIban: r.counterpartyIban, textContains: r.textContains, amountMinCents: r.amountMinCents, amountMaxCents: r.amountMaxCents,
});

/** Nur Schlüssel, IDs und Flags — die Whitelist in `audit.ts` verwirft den Rest ohnehin. */
function auditOf(row: FinanceImportRuleRow): Record<string, unknown> {
  return {
    ...row,
    hasBankDetailsCondition: row.counterpartyIban !== null,
    hasWordCondition: row.textContains !== null,
    hasAmountCondition: row.amountMinCents !== null || row.amountMaxCents !== null,
    partySet: row.contactId !== null,
  };
}

interface RuleCorpus {
  targets: (RuleTarget & { id: string })[];
  /** Kontoumsatz → die Buchung, die ihn bindet (Entwurf oder festgeschrieben). */
  entryByRaw: Map<string, string>;
  /** Buchung → Kategorien ihrer Zuordnungen. */
  categoriesByEntry: Map<string, string[]>;
}

/** Alle Kontoumsätze aus nicht verworfenen Auszügen, dazu wer sie bindet — einmal geladen, für jede Regel gezählt. */
function ruleCorpusInternal(db: DbOrTx): RuleCorpus {
  const targets = db
    .select({
      id: financeRawTransactions.id, bookingDate: financeRawTransactions.bookingDate, accountId: financeRawTransactions.accountId, amountCents: financeRawTransactions.amountCents,
      counterpartyName: financeRawTransactions.counterpartyName, counterpartyIban: financeRawTransactions.counterpartyIban, purpose: financeRawTransactions.purpose,
    })
    .from(financeRawTransactions)
    .innerJoin(financeImportRuns, eq(financeImportRuns.id, financeRawTransactions.runId))
    .where(isNull(financeImportRuns.discardedAt))
    .all();
  const bound = db
    .select({ rawTransactionId: financeMoneyLines.rawTransactionId, entryId: financeMoneyLines.entryId })
    .from(financeMoneyLines)
    .where(and(isNotNull(financeMoneyLines.rawTransactionId), isNull(financeMoneyLines.rawReleasedAt)))
    .all();
  const entryByRaw = new Map(bound.map((b) => [b.rawTransactionId!, b.entryId] as const));
  const entryIds = [...new Set(entryByRaw.values())];
  const categoriesByEntry = new Map<string, string[]>();
  if (entryIds.length > 0) {
    for (const line of db.select({ entryId: financeAllocationLines.entryId, categoryId: financeAllocationLines.categoryId }).from(financeAllocationLines).where(inArray(financeAllocationLines.entryId, entryIds)).all()) {
      categoriesByEntry.set(line.entryId, [...(categoriesByEntry.get(line.entryId) ?? []), line.categoryId]);
    }
  }
  return { targets, entryByRaw, categoriesByEntry };
}

/**
 * „Anders gebucht“ = gebunden an eine Buchung (Entwurf oder festgeschrieben),
 * deren Zuordnungen nicht alle auf der Kategorie der Regel liegen — auch eine
 * Umbuchung ohne Zuordnung zählt dazu. Offene Treffer zählen nur als Treffer.
 */
function ruleStatsInternal(corpus: RuleCorpus, conditions: RuleConditions, categoryId: string): { hitCount: number; differentlyBookedEntryIds: string[] } {
  let hitCount = 0;
  const differently = new Set<string>();
  for (const target of corpus.targets) {
    if (!ruleMatches(conditions, target)) continue;
    hitCount += 1;
    const entryId = corpus.entryByRaw.get(target.id);
    if (!entryId) continue;
    const categories = corpus.categoriesByEntry.get(entryId) ?? [];
    if (categories.length === 0 || categories.some((c) => c !== categoryId)) differently.add(entryId);
  }
  return { hitCount, differentlyBookedEntryIds: [...differently] };
}

function ruleViewsInternal(db: DbOrTx, rows: FinanceImportRuleRow[]): ImportRuleView[] {
  if (rows.length === 0) return [];
  const corpus = ruleCorpusInternal(db);
  const categories = new Map(db.select({ id: financeCategories.id, name: financeCategories.name, isActive: financeCategories.isActive }).from(financeCategories).all().map((c) => [c.id, c] as const));
  return rows.map((row) => {
    const category = categories.get(row.categoryId);
    const stats = ruleStatsInternal(corpus, conditionsOf(row), row.categoryId);
    return { ...row, categoryName: category?.name ?? '', categoryInactive: !category?.isActive, hitCount: stats.hitCount, differentlyBookedCount: stats.differentlyBookedEntryIds.length };
  });
}

/** `finance.entriesWrite` (Spec 10.1 „Regeln“). Ohne `id` neu, am Ende der Reihenfolge; mit `id` ersetzt sie Bedingung und Ergebnis. */
export async function saveImportRule(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ImportRuleView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveImportRuleSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financeImportRules).where(eq(financeImportRules.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financeImportRule', v.id);
  if (!deps.db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.id, v.categoryId)).get()) return notFound('financeCategory', v.categoryId);
  if (v.purposeId && !deps.db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, v.purposeId)).get()) return notFound('financePurpose', v.purposeId);
  if (v.accountId && !deps.db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get()) return notFound('financeAccount', v.accountId);

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const nextOrder = () => {
      const max = tx.select({ max: sql<number | null>`max(${financeImportRules.sortOrder})` }).from(financeImportRules).get()?.max;
      return max === null || max === undefined ? 0 : Number(max) + 1;
    };
    const row: FinanceImportRuleRow = {
      id: before?.id ?? newId(),
      name: v.name,
      sortOrder: v.sortOrder ?? before?.sortOrder ?? nextOrder(),
      isActive: v.isActive ?? before?.isActive ?? true,
      accountId: v.accountId,
      direction: v.direction,
      counterpartyIban: v.counterpartyIban ? normalizeIban(v.counterpartyIban) : null,
      textContains: v.textContains,
      amountMinCents: v.amountMinCents,
      amountMaxCents: v.amountMaxCents,
      categoryId: v.categoryId,
      projectId: v.projectId,
      purposeId: v.purposeId,
      contactId: v.contactId,
      taxCode: v.taxCode,
      entryText: v.entryText,
      createdAt: before?.createdAt ?? now,
      createdByUserId: before?.createdByUserId ?? ctx.userId ?? 'system',
      updatedAt: now,
    };
    if (before) tx.update(financeImportRules).set(row).where(eq(financeImportRules.id, row.id)).run();
    else tx.insert(financeImportRules).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.importRule.save', entity: 'financeImportRule', id: row.id, before: before ? auditOf(before) : undefined, after: auditOf(row), summary: `Regel ${row.id} gespeichert` });
    return ok(ruleViewsInternal(tx, [row])[0]!);
  });
}

/** `finance.read`: Regeln tragen IBANs und Kontakte. In ihrer Reihenfolge — die erste treffende gewinnt. */
export async function listImportRules(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ rules: ImportRuleView[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listImportRulesSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db
    .select()
    .from(financeImportRules)
    .where(parsed.value.includeInactive ? undefined : eq(financeImportRules.isActive, true))
    .orderBy(asc(financeImportRules.sortOrder), asc(financeImportRules.createdAt))
    .all();
  return ok({ rules: ruleViewsInternal(deps.db, rows) });
}

/** Die aktiven Regeln in ihrer Reihenfolge — für die Vorschläge (Task 4). */
export function activeImportRulesInternal(db: DbOrTx): FinanceImportRuleRow[] {
  return db.select().from(financeImportRules).where(eq(financeImportRules.isActive, true)).orderBy(asc(financeImportRules.sortOrder), asc(financeImportRules.createdAt)).all();
}

/** `finance.entriesWrite`; Löschregel `financeImportRule` — Arbeitsmaterial. */
export async function deleteImportRule(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, deleteImportRuleSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeImportRules).where(eq(financeImportRules.id, parsed.value.id)).get();
  if (!before) return notFound('financeImportRule', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeImportRules).where(eq(financeImportRules.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.importRule.delete', entity: 'financeImportRule', id: before.id, before: auditOf(before), summary: `Regel ${before.id} gelöscht` });
    return ok({ id: before.id });
  });
}

/**
 * `finance.read`: „trifft N frühere Umsätze, davon M anders gebucht“ — über
 * alle Kontoumsätze aus nicht verworfenen Auszügen. Liest nur; eine Regel
 * wirkt nie rückwirkend.
 */
export async function previewImportRule(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ hitCount: number; differentlyBookedCount: number; differentlyBookedEntryIds: string[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, previewImportRuleSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const stats = ruleStatsInternal(ruleCorpusInternal(deps.db), conditionsOf({ ...v, counterpartyIban: v.counterpartyIban ? normalizeIban(v.counterpartyIban) : null }), v.categoryId);
  return ok({ hitCount: stats.hitCount, differentlyBookedCount: stats.differentlyBookedEntryIds.length, differentlyBookedEntryIds: stats.differentlyBookedEntryIds });
}
