import { expectedVersionField, isoNow, newId, notFound, ok, requirePermission, staleVersion, validate, hasPermission, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { projects } from '@kompass/module-projects';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financePurposes, type FinancePurposeRow } from '../schema';
import { requireFinanceRead } from './access';

const base = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  referenceNote: z.string().trim().max(120).nullable().optional(),
  targetCents: z.number().int().nullable().optional(),
  abroad: z.boolean().default(false),
  carryForwardCents: z.number().int().nullable().optional(),
  carryForwardDate: z.string().date().nullable().optional(),
});
type Fields = z.infer<typeof base>;

function check(v: Pick<Fields, 'carryForwardCents' | 'carryForwardDate'>, c: z.RefinementCtx): void {
  if ((v.carryForwardCents ?? null) !== null && !v.carryForwardDate) c.addIssue({ code: 'custom', path: ['carryForwardDate'], message: 'carryForwardDateRequired' });
  if (v.carryForwardDate && (v.carryForwardCents ?? null) === null) c.addIssue({ code: 'custom', path: ['carryForwardCents'], message: 'carryForwardCentsRequired' });
}

const purposeCreateSchema = base.superRefine(check);
const purposeUpdateSchema = base.partial().extend({ id: z.string().min(1), expectedVersion: expectedVersionField });

/** Wie `FinancePurposeRow`, nur dass die Liste den Freitext ohne `finance.read` auf `null` setzt. */
export type PurposeView = Omit<FinancePurposeRow, 'description'> & { description: string | null };

/** F1 kennt noch keine Buchungszeilen. F2a/F2c ergänzen hier die Abfrage. */
export function purposeInUseInternal(_db: DbOrTx, _purposeId: string): boolean {
  return false;
}

function projectExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

export async function createPurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, purposeCreateSchema, input);
  if (!parsed.ok) return parsed;
  if (parsed.value.projectId && !projectExists(deps.db, parsed.value.projectId)) return notFound('project', parsed.value.projectId);

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    const row: FinancePurposeRow = {
      id,
      name: parsed.value.name,
      description: parsed.value.description ?? '',
      projectId: parsed.value.projectId ?? null,
      referenceNote: parsed.value.referenceNote ?? null,
      targetCents: parsed.value.targetCents ?? null,
      abroad: parsed.value.abroad,
      carryForwardCents: parsed.value.carryForwardCents ?? null,
      carryForwardDate: parsed.value.carryForwardDate ?? null,
      fulfilledAt: null,
      fulfilledByUserId: null,
      dissolvedAt: null,
      dissolvedByUserId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(financePurposes).values(row).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.create', entity: 'financePurpose', id, after: row, summary: `Zweck ${id} angelegt` });
    return ok(row);
  });
}

function load(db: DbOrTx, id: string): FinancePurposeRow | null {
  return db.select().from(financePurposes).where(eq(financePurposes.id, id)).get() ?? null;
}

const closedConflict = () => financeConflict('purposeClosed');

export async function updatePurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, purposeUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('financePurpose', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.fulfilledAt || before.dissolvedAt) return closedConflict();

  const merged = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, val]) => val !== undefined)) };
  const rechecked = validate(deps, purposeCreateSchema, { name: merged.name, description: merged.description, projectId: merged.projectId, referenceNote: merged.referenceNote, targetCents: merged.targetCents, abroad: merged.abroad, carryForwardCents: merged.carryForwardCents, carryForwardDate: merged.carryForwardDate });
  if (!rechecked.ok) return rechecked;
  if (merged.projectId && !projectExists(deps.db, merged.projectId)) return notFound('project', merged.projectId);

  return deps.db.transaction((tx: DbOrTx) => {
    const after = { ...merged, updatedAt: isoNow(deps.clock) };
    tx.update(financePurposes).set(after).where(eq(financePurposes.id, id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.update', entity: 'financePurpose', id, before, after, summary: `Zweck ${id} geändert` });
    return ok(after);
  });
}

const idSchema = z.object({ id: z.string().min(1), expectedVersion: expectedVersionField });

export async function fulfillPurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financePurpose', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.fulfilledAt || before.dissolvedAt) return closedConflict();
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after = { ...before, fulfilledAt: now, fulfilledByUserId: ctx.userId, updatedAt: now };
    tx.update(financePurposes).set({ fulfilledAt: after.fulfilledAt, fulfilledByUserId: after.fulfilledByUserId, updatedAt: after.updatedAt }).where(eq(financePurposes.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.fulfill', entity: 'financePurpose', id: before.id, before, after, summary: `Zweck ${before.id} erfüllt` });
    return ok(after);
  });
}

export async function dissolvePurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financePurpose', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.fulfilledAt || before.dissolvedAt) return closedConflict();
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after = { ...before, dissolvedAt: now, dissolvedByUserId: ctx.userId, updatedAt: now };
    tx.update(financePurposes).set({ dissolvedAt: after.dissolvedAt, dissolvedByUserId: after.dissolvedByUserId, updatedAt: after.updatedAt }).where(eq(financePurposes.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.dissolve', entity: 'financePurpose', id: before.id, before, after, summary: `Zweck ${before.id} aufgelöst` });
    return ok(after);
  });
}

export async function reopenPurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financePurpose', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after = { ...before, fulfilledAt: null, fulfilledByUserId: null, dissolvedAt: null, dissolvedByUserId: null, updatedAt: now };
    tx.update(financePurposes).set({ fulfilledAt: null, fulfilledByUserId: null, dissolvedAt: null, dissolvedByUserId: null, updatedAt: now }).where(eq(financePurposes.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.reopen', entity: 'financePurpose', id: before.id, before, after, summary: `Zweck ${before.id} wieder geöffnet` });
    return ok(after);
  });
}

const purposeActiveSchema = z.object({ id: z.string().min(1), isActive: z.boolean(), expectedVersion: expectedVersionField });

/** Muster wie `setAccountActive`/`setCategoryActive` — die drei Stammdatenarten des Verteilers `finance_master_data*` teilen die Form. */
export async function setPurposeActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, purposeActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financePurpose', parsed.value.id);
  const stale = staleVersion(parsed.value.expectedVersion, before.updatedAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const after = { ...before, isActive: parsed.value.isActive, updatedAt: isoNow(deps.clock) };
    tx.update(financePurposes).set({ isActive: after.isActive, updatedAt: after.updatedAt }).where(eq(financePurposes.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.setActive', entity: 'financePurpose', id: before.id, before, after, summary: `Zweck ${before.id} ${after.isActive ? 'aktiviert' : 'stillgelegt'}` });
    return ok(after);
  });
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deletePurpose(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, deleteSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('financePurpose', parsed.value.id);
  if (purposeInUseInternal(deps.db, before.id)) return financeConflict('purposeInUse');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financePurposes).where(eq(financePurposes.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.purpose.delete', entity: 'financePurpose', id: before.id, before, summary: `Zweck ${before.id} gelöscht` });
    return ok({ id: before.id });
  });
}

const listSchema = z.object({ includeInactive: z.boolean().default(false) });

export async function listPurposes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PurposeView[]>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financePurposes).orderBy(asc(financePurposes.name)).all().filter((r) => parsed.value.includeInactive || r.isActive);
  // Der Freitext kann Namen tragen („Zusage von Frau Muster“): nur mit `finance.read`.
  const full = hasPermission(ctx, 'finance.read');
  return ok<PurposeView[]>(full ? rows : rows.map((r) => ({ ...r, description: null })));
}
