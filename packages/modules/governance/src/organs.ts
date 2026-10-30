import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { governanceOffices, governanceOrgans, ORGAN_KINDS, type OfficeFunction, type OfficeRow, type OrganKind, type OrganRow } from './schema';

export interface OfficeView {
  id: string;
  organId: string;
  name: string;
  seats: number;
  representative: boolean;
  termMonths: number | null;
  untilSuccessor: boolean;
  function: OfficeFunction | null;
  incompatibleWith: string[];
  active: boolean;
}
export interface OrganView {
  id: string;
  kind: OrganKind;
  name: string;
  active: boolean;
  offices: OfficeView[];
}

export const organListSchema = z.object({ includeInactive: z.boolean().optional() });
export const organSaveSchema = z.object({
  /** Ohne `id` wird angelegt — neu nur `other`; beim Ändern steht die Art fest und `kind` wird übergangen. */
  id: z.string().min(1).optional(),
  kind: z.enum(ORGAN_KINDS),
  name: z.string().trim().min(1).max(120),
});
export const organActiveSchema = z.object({ id: z.string().min(1), active: z.boolean() });

export const officeView = (row: OfficeRow): OfficeView => ({
  id: row.id,
  organId: row.organId,
  name: row.name,
  seats: row.seats,
  representative: row.representative,
  termMonths: row.termMonths,
  untilSuccessor: row.untilSuccessor,
  function: row.function,
  incompatibleWith: row.incompatibleWith,
  active: row.active,
});

function organView(db: DbOrTx, row: OrganRow, includeInactive: boolean): OrganView {
  const offices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, row.id)).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all();
  return { id: row.id, kind: row.kind, name: row.name, active: row.active, offices: offices.filter((o) => includeInactive || o.active).map(officeView) };
}

const loadOrgan = (db: DbOrTx, id: string): OrganRow | undefined => db.select().from(governanceOrgans).where(eq(governanceOrgans.id, id)).get();

/** Die Organe in ihrer Reihenfolge mit ihren Ämtern; ohne `includeInactive` nur die aktiven (Organe wie Ämter). */
export async function listOrgans(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OrganView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, organListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const all = parsed.value.includeInactive === true;
  const rows = deps.db.select().from(governanceOrgans).orderBy(asc(governanceOrgans.sortOrder), asc(governanceOrgans.id)).all();
  return ok(rows.filter((r) => all || r.active).map((r) => organView(deps.db, r, all)));
}

/** Legt ein weiteres Organ an (Beirat, Ausschuss …) oder benennt eines um. MV und Vorstand gibt es je genau einmal. */
export async function saveOrgan(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OrganView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, organSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id, kind, name } = parsed.value;
  const now = isoNow(deps.clock);
  if (id === undefined) {
    if (kind !== 'other') return invalid([{ path: 'kind', message: 'onlyOther' }]);
    return deps.db.transaction((tx: DbOrTx) => {
      const max = tx.select({ n: sql<number>`coalesce(max(${governanceOrgans.sortOrder}), 0)` }).from(governanceOrgans).get()?.n ?? 0;
      const row: OrganRow = { id: newId(), kind, name, active: true, sortOrder: max + 1, createdAt: now, updatedAt: now };
      tx.insert(governanceOrgans).values(row).run();
      recordAudit(tx, deps, ctx, { action: 'governance.organ.create', entityType: 'governanceOrgan', entityId: row.id, after: { kind, name }, params: { kind } });
      return ok(organView(tx, row, false));
    });
  }
  const before = loadOrgan(deps.db, id);
  if (!before) return notFound('governanceOrgan', id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceOrgans).set({ name, updatedAt: now }).where(eq(governanceOrgans.id, id)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.organ.update', entityType: 'governanceOrgan', entityId: id, before: { name: before.name }, after: { name }, params: { kind: before.kind } });
    return ok(organView(tx, loadOrgan(tx, id)!, false));
  });
}

/** Archiviert oder holt ein Organ zurück. Mitgliederversammlung und Vorstand bleiben immer aktiv. */
export async function setOrganActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OrganView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, organActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadOrgan(deps.db, parsed.value.id);
  if (!before) return notFound('governanceOrgan', parsed.value.id);
  if (!parsed.value.active && before.kind !== 'other') return governanceConflict('organRequired');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceOrgans).set({ active: parsed.value.active, updatedAt: isoNow(deps.clock) }).where(eq(governanceOrgans.id, before.id)).run();
    const entry = { entityType: 'governanceOrgan', entityId: before.id, before: { active: before.active }, after: { active: parsed.value.active }, params: { kind: before.kind } };
    if (parsed.value.active) recordAudit(tx, deps, ctx, { action: 'governance.organ.activate', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'governance.organ.deactivate', ...entry });
    return ok(organView(tx, loadOrgan(tx, before.id)!, true));
  });
}
