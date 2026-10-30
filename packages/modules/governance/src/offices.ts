import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles, setRoleRowRepresentationInternal } from '@kompass/module-contacts';
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from './errors';
import { officeView, type OfficeView } from './organs';
import { occasion, recordRegisterOccasionInternal, withdrawOpenRepresentationOccasionInternal } from './seal/occasions';
import { governanceOffices, governanceOrgans, governanceTerms, OFFICE_FUNCTIONS, type OfficeRow } from './schema';

export const officeSaveSchema = z.object({
  /** Ohne `id` wird angelegt. */
  id: z.string().min(1).optional(),
  organId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  seats: z.number().int().min(1).max(99),
  representative: z.boolean(),
  termMonths: z.number().int().min(1).max(240).nullable(),
  untilSuccessor: z.boolean(),
  function: z.enum(OFFICE_FUNCTIONS).nullable(),
  incompatibleWith: z.array(z.string().min(1)).max(50),
});
export const officeActiveSchema = z.object({ id: z.string().min(1), active: z.boolean() });

const loadOffice = (db: DbOrTx, id: string): OfficeRow | undefined => db.select().from(governanceOffices).where(eq(governanceOffices.id, id)).get();

/** Legt ein Amt an einem Organ an oder ändert es. Das Protokoll nennt keine Werte: Der Name ist die Entität. */
export async function saveOffice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OfficeView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, officeSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...values } = parsed.value;
  if (!deps.db.select({ id: governanceOrgans.id }).from(governanceOrgans).where(eq(governanceOrgans.id, values.organId)).get()) return invalid([{ path: 'organId', message: 'referenceNotFound' }]);
  const known = new Set(deps.db.select({ id: governanceOffices.id }).from(governanceOffices).all().map((o) => o.id));
  if (values.incompatibleWith.some((other) => !known.has(other) || other === id)) return invalid([{ path: 'incompatibleWith', message: 'referenceNotFound' }]);
  const now = isoNow(deps.clock);
  if (id === undefined) {
    return deps.db.transaction((tx: DbOrTx) => {
      const max = tx.select({ n: sql<number>`coalesce(max(${governanceOffices.sortOrder}), 0)` }).from(governanceOffices).where(eq(governanceOffices.organId, values.organId)).get()?.n ?? 0;
      const row: OfficeRow = { id: newId(), ...values, active: true, sortOrder: max + 1, createdAt: now, updatedAt: now };
      tx.insert(governanceOffices).values(row).run();
      recordAudit(tx, deps, ctx, { action: 'governance.office.create', entityType: 'governanceOffice', entityId: row.id, after: values, params: {} });
      return ok(officeView(row));
    });
  }
  const before = loadOffice(deps.db, id);
  if (!before) return notFound('governanceOffice', id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceOffices).set({ ...values, updatedAt: now }).where(eq(governanceOffices.id, id)).run();
    const { id: _id, createdAt: _c, updatedAt: _u, active: _a, sortOrder: _s, ...was } = before;
    recordAudit(tx, deps, ctx, { action: 'governance.office.update', entityType: 'governanceOffice', entityId: id, before: was, after: values, params: {} });
    // Die Vertretungsregel ändert sich (§ 67 BGB, Spec § 6): ein Amt wird vertretend oder nicht, oder ein vertretendes ändert seine Plätze.
    // Nur „vertritt“ am selben Tag zurückgeschaltet: der offene Anlass von vorhin entfällt, es bleibt alles beim Alten (V-6).
    const flippedBack = before.representative !== values.representative && before.seats === values.seats && withdrawOpenRepresentationOccasionInternal(tx, deps, ctx, id, todayIn(deps));
    if (!flippedBack && (before.representative !== values.representative || (values.representative && before.seats !== values.seats))) recordRegisterOccasionInternal(tx, deps, ctx, occasion('representation', todayIn(deps), { officeId: id }));
    // Die Vorstandsrollen der laufenden Inhaberschaften folgen sofort; beendete bleiben, wie sie waren (G7).
    if (before.representative !== values.representative) {
      const today = todayIn(deps);
      const running = tx.select().from(governanceTerms).where(and(eq(governanceTerms.officeId, id), or(isNull(governanceTerms.until), gte(governanceTerms.until, today)))).all();
      const rowIds = running.flatMap((t) => t.roleRowIds);
      const boardRows = rowIds.length === 0 ? [] : tx.select().from(contactRoles).where(and(inArray(contactRoles.id, rowIds), eq(contactRoles.role, 'board-member'))).all();
      for (const row of boardRows) if (row.until === null || row.until >= today) setRoleRowRepresentationInternal(tx, deps, ctx, { rowId: row.id, representsAssociation: values.representative });
    }
    return ok(officeView(loadOffice(tx, id)!));
  });
}

/** Archiviert ein Amt oder holt es zurück — archivieren nur, solange niemand es heute oder künftig innehat. */
export async function setOfficeActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OfficeView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, officeActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadOffice(deps.db, parsed.value.id);
  if (!before) return notFound('governanceOffice', parsed.value.id);
  if (!parsed.value.active) {
    const today = todayIn(deps);
    const occupied = deps.db
      .select({ id: governanceTerms.id })
      .from(governanceTerms)
      .where(and(eq(governanceTerms.officeId, before.id), or(isNull(governanceTerms.until), gte(governanceTerms.until, today))))
      .get();
    if (occupied) return governanceConflict('officeOccupied');
  }
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceOffices).set({ active: parsed.value.active, updatedAt: isoNow(deps.clock) }).where(eq(governanceOffices.id, before.id)).run();
    const entry = { entityType: 'governanceOffice', entityId: before.id, before: { active: before.active }, after: { active: parsed.value.active }, params: {} };
    if (parsed.value.active) recordAudit(tx, deps, ctx, { action: 'governance.office.activate', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'governance.office.deactivate', ...entry });
    return ok(officeView(loadOffice(tx, before.id)!));
  });
}
