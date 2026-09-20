import { expectedVersionField, isoNow, newId, notFound, ok, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeCategories, type FinanceCategoryRow } from '../schema';
import { requireFinanceRead } from './access';
import { ALLOWANCE_KINDS, CERTIFIABLE_INCOME_KINDS, COST_FUNCTIONS, DIRECTIONS, INCOME_KINDS, INPUT_TAX, SPHERES, TAX_CODES } from './codes';

/** Plain fields, ohne die Regeltabelle — Grundlage für Erstellung, Update und Startplan. */
const categoryBase = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(120),
  explanation: z.string().trim().max(500).default(''),
  direction: z.enum(DIRECTIONS),
  sphere: z.enum(SPHERES).optional(),
  incomeKind: z.enum(INCOME_KINDS).optional(),
  costFunction: z.enum(COST_FUNCTIONS).optional(),
  allowanceKind: z.enum(ALLOWANCE_KINDS).default('none'),
  statementSuffices: z.boolean().default(false),
  defaultTaxCode: z.enum(TAX_CODES).default('none'),
  inputTaxDeductible: z.enum(INPUT_TAX).default('no'),
  countsTowardTurnover: z.boolean().default(false),
  isAssetSale: z.boolean().default(false),
  externalAccountNumber: z.string().trim().max(12).nullable().optional(),
});
type CategoryFields = z.infer<typeof categoryBase>;

/** Regeltabelle Spec 5.1 — jede Zeile ein eigener Validierungsschlüssel. */
function checkCategory(v: CategoryFields, c: z.RefinementCtx): void {
  if (v.direction === 'transit') {
    if (v.sphere !== undefined || v.incomeKind !== undefined || v.costFunction !== undefined) {
      c.addIssue({ code: 'custom', path: ['sphere'], message: 'transitHasNoSphere' });
    }
    return;
  }
  if (v.sphere === undefined) c.addIssue({ code: 'custom', path: ['sphere'], message: 'sphereRequired' });
  if (v.direction === 'income') {
    if (v.incomeKind === undefined) c.addIssue({ code: 'custom', path: ['incomeKind'], message: 'incomeKindRequired' });
    if (v.costFunction !== undefined) c.addIssue({ code: 'custom', path: ['costFunction'], message: 'costFunctionOnlyForExpense' });
  } else {
    if (v.costFunction === undefined) c.addIssue({ code: 'custom', path: ['costFunction'], message: 'costFunctionRequired' });
    if (v.incomeKind !== undefined) c.addIssue({ code: 'custom', path: ['incomeKind'], message: 'incomeKindOnlyForIncome' });
  }
  if (v.incomeKind && (CERTIFIABLE_INCOME_KINDS as readonly string[]).includes(v.incomeKind) && v.sphere !== undefined && v.sphere !== 'ideal') {
    c.addIssue({ code: 'custom', path: ['incomeKind'], message: 'certifiableOnlyIdeal' });
  }
  if (v.allowanceKind !== 'none' && v.direction !== 'expense') {
    c.addIssue({ code: 'custom', path: ['allowanceKind'], message: 'allowanceOnlyForExpense' });
  }
  if (v.inputTaxDeductible !== 'no' && !(v.direction === 'expense' && v.sphere !== 'ideal')) {
    c.addIssue({ code: 'custom', path: ['inputTaxDeductible'], message: 'inputTaxNotInIdeal' });
  }
}

export const categoryFieldsSchema = categoryBase.superRefine(checkCategory);

const categoryUpdateSchema = categoryBase
  .omit({ key: true })
  .partial()
  .extend({ id: z.string().min(1), expectedVersion: expectedVersionField })
  .strict();

export type CategoryView = FinanceCategoryRow;

/** F1 kennt noch keine Buchungszeilen. F2a ergänzt hier die Abfrage. */
export function categoryInUseInternal(_db: DbOrTx, _categoryId: string): boolean {
  return false;
}

function keyTaken(db: DbOrTx, key: string): boolean {
  return !!db.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.key, key)).get();
}

/** Insert plus Protokoll — für den eigenen Dienst und den Startplan (Task 6, `install.ts`). Erwartet bereits geprüfte Felder. */
export function createCategoryInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, fields: CategoryFields): FinanceCategoryRow {
  const id = newId();
  const now = isoNow(deps.clock);
  const row: FinanceCategoryRow = {
    id,
    key: fields.key,
    name: fields.name,
    explanation: fields.explanation,
    direction: fields.direction,
    sphere: fields.sphere ?? null,
    incomeKind: fields.incomeKind ?? null,
    costFunction: fields.costFunction ?? null,
    allowanceKind: fields.allowanceKind,
    statementSuffices: fields.statementSuffices,
    defaultTaxCode: fields.defaultTaxCode,
    inputTaxDeductible: fields.inputTaxDeductible,
    countsTowardTurnover: fields.countsTowardTurnover,
    isAssetSale: fields.isAssetSale,
    externalAccountNumber: fields.externalAccountNumber ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  tx.insert(financeCategories).values(row).run();
  financeAudit(tx, deps, ctx, { action: 'finance.category.create', entity: 'financeCategory', id, after: row, summary: `Kategorie ${row.key} angelegt` });
  return row;
}

export async function createCategory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CategoryView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, categoryFieldsSchema, input);
  if (!parsed.ok) return parsed;
  if (keyTaken(deps.db, parsed.value.key)) return financeConflict('categoryKeyTaken', { key: parsed.value.key });
  return deps.db.transaction((tx: DbOrTx) => ok(createCategoryInternal(tx, deps, ctx, parsed.value)));
}

export async function updateCategory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CategoryView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, categoryUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, ...changes } = parsed.value;
  const before = deps.db.select().from(financeCategories).where(eq(financeCategories.id, id)).get();
  if (!before) return notFound('financeCategory', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;

  const merged = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, val]) => val !== undefined)) };
  const rechecked = validate(deps, categoryFieldsSchema, {
    key: before.key,
    name: merged.name,
    explanation: merged.explanation,
    direction: merged.direction,
    sphere: merged.sphere ?? undefined,
    incomeKind: merged.incomeKind ?? undefined,
    costFunction: merged.costFunction ?? undefined,
    allowanceKind: merged.allowanceKind,
    statementSuffices: merged.statementSuffices,
    defaultTaxCode: merged.defaultTaxCode,
    inputTaxDeductible: merged.inputTaxDeductible,
    countsTowardTurnover: merged.countsTowardTurnover,
    isAssetSale: merged.isAssetSale,
    externalAccountNumber: merged.externalAccountNumber ?? undefined,
  });
  if (!rechecked.ok) return rechecked;

  return deps.db.transaction((tx: DbOrTx) => {
    const after = { ...merged, updatedAt: isoNow(deps.clock) };
    tx.update(financeCategories).set(after).where(eq(financeCategories.id, id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.category.update', entity: 'financeCategory', id, before, after, summary: `Kategorie ${before.key} geändert` });
    return ok(after);
  });
}

const categoryActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean(), expectedVersion: expectedVersionField });

export async function setCategoryActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CategoryView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, categoryActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeCategories).where(eq(financeCategories.id, parsed.value.id)).get();
  if (!before) return notFound('financeCategory', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const after = { ...before, isActive: parsed.value.isActive, updatedAt: isoNow(deps.clock) };
    tx.update(financeCategories).set({ isActive: after.isActive, updatedAt: after.updatedAt }).where(eq(financeCategories.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.category.setActive', entity: 'financeCategory', id: before.id, before, after, summary: `Kategorie ${before.key} ${after.isActive ? 'aktiviert' : 'stillgelegt'}` });
    return ok(after);
  });
}

const categoryDeleteSchema = z.object({ id: z.string().min(1) });

export async function deleteCategory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, categoryDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeCategories).where(eq(financeCategories.id, parsed.value.id)).get();
  if (!before) return notFound('financeCategory', parsed.value.id);
  if (categoryInUseInternal(deps.db, before.id)) return financeConflict('categoryInUse');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financeCategories).where(eq(financeCategories.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.category.delete', entity: 'financeCategory', id: before.id, before, summary: `Kategorie ${before.key} gelöscht` });
    return ok({ id: before.id });
  });
}

const categoryListSchema = z.object({ includeInactive: z.boolean().default(false) });

export async function listCategories(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CategoryView[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, categoryListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financeCategories).orderBy(asc(financeCategories.key)).all().filter((r) => parsed.value.includeInactive || r.isActive);
  return ok(rows);
}
