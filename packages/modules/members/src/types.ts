import { invalid, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { membersConflict } from './errors';
import { lastMemberNumber, setLastMemberNumber } from './numbers';
import { memberTypePeriods, memberTypes, type MemberTypeRow } from './schema';

export const MEMBER_TYPE_KEY = /^[a-z][a-z0-9-]{1,40}$/;

export const memberTypeListSchema = z.object({ includeInactive: z.boolean().optional() });
export const memberTypeSaveSchema = z.object({
  /** Ohne `id` wird angelegt, dann ist `key` Pflicht; beim Ändern steht der Schlüssel fest und `key` wird übergangen. */
  id: z.string().min(1).optional(),
  key: z.string().regex(MEMBER_TYPE_KEY).optional(),
  name: localizedText({ required: true, max: 120 }),
  hasVotingRight: z.boolean(),
  feeExempt: z.boolean(),
});
export const memberTypeActiveSchema = z.object({ id: z.string().min(1), active: z.boolean() });
export const memberTypeReorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });
export const memberTypeDeleteSchema = z.object({ id: z.string().min(1) });
export const nextMemberNumberSchema = z.object({ next: z.number().int().min(1) });

const loadType = (db: DbOrTx, id: string): MemberTypeRow | undefined => db.select().from(memberTypes).where(eq(memberTypes.id, id)).get();

/** Die Mitgliedsarten in ihrer Reihenfolge; ohne `includeInactive` nur die aktiven. */
export async function listMemberTypes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberTypeRow[]>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, memberTypeListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(memberTypes).orderBy(asc(memberTypes.sortOrder), asc(memberTypes.key)).all();
  return ok(parsed.value.includeInactive ? rows : rows.filter((r) => r.active));
}

/** Legt eine Mitgliedsart an oder ändert Name, Stimmrecht und Beitragsfreiheit. */
export async function saveMemberType(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberTypeRow>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, memberTypeSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id, key, name, hasVotingRight, feeExempt } = parsed.value;
  const now = isoNow(deps.clock);
  if (id === undefined) {
    if (key === undefined) return invalid([{ path: 'key', message: 'required' }]);
    if (deps.db.select({ id: memberTypes.id }).from(memberTypes).where(eq(memberTypes.key, key)).get()) return membersConflict('memberTypeKeyTaken', { key });
    return deps.db.transaction((tx: DbOrTx) => {
      const max = tx.select({ n: sql<number>`coalesce(max(${memberTypes.sortOrder}), 0)` }).from(memberTypes).get()?.n ?? 0;
      const row: MemberTypeRow = { id: newId(), key, name, hasVotingRight, feeExempt, active: true, sortOrder: max + 1, createdAt: now, updatedAt: now };
      tx.insert(memberTypes).values(row).run();
      recordAudit(tx, deps, ctx, { action: 'members.type.create', entityType: 'memberType', entityId: row.id, after: { key, name, hasVotingRight, feeExempt }, params: { key } });
      return ok(row);
    });
  }
  const before = loadType(deps.db, id);
  if (!before) return notFound('memberType', id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(memberTypes).set({ name, hasVotingRight, feeExempt, updatedAt: now }).where(eq(memberTypes.id, id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'members.type.update',
      entityType: 'memberType',
      entityId: id,
      before: { name: before.name, hasVotingRight: before.hasVotingRight, feeExempt: before.feeExempt },
      after: { name, hasVotingRight, feeExempt },
      params: { key: before.key },
    });
    return ok(loadType(tx, id)!);
  });
}

/** Deaktiviert oder aktiviert eine Art. Eine deaktivierte Art bleibt an ihren Mitgliedschaften, neue bekommen sie nicht. */
export async function setMemberTypeActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MemberTypeRow>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, memberTypeActiveSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadType(deps.db, parsed.value.id);
  if (!before) return notFound('memberType', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(memberTypes).set({ active: parsed.value.active, updatedAt: isoNow(deps.clock) }).where(eq(memberTypes.id, before.id)).run();
    const entry = { entityType: 'memberType', entityId: before.id, before: { active: before.active }, after: { active: parsed.value.active }, params: { key: before.key } };
    if (parsed.value.active) recordAudit(tx, deps, ctx, { action: 'members.type.activate', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'members.type.deactivate', ...entry });
    return ok(loadType(tx, before.id)!);
  });
}

/** Neue Reihenfolge: `ids` nennt jede Art genau einmal. */
export async function reorderMemberTypes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, memberTypeReorderSchema, input);
  if (!parsed.ok) return parsed;
  const all = deps.db.select({ id: memberTypes.id }).from(memberTypes).all().map((r) => r.id);
  const given = new Set(parsed.value.ids);
  if (given.size !== parsed.value.ids.length) return invalid([{ path: 'ids', message: 'duplicateIds' }]);
  if (given.size !== all.length || all.some((id) => !given.has(id))) return invalid([{ path: 'ids', message: 'invalid' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    parsed.value.ids.forEach((id, index) => tx.update(memberTypes).set({ sortOrder: index + 1 }).where(eq(memberTypes.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'members.type.reorder', entityType: 'memberType', entityId: null, after: parsed.value.ids, params: {} });
    return ok(undefined);
  });
}

/** Löscht eine Art, die nie an einer Mitgliedschaft stand. Sonst bleibt sie (deaktivieren statt löschen). */
export async function deleteMemberType(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, memberTypeDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadType(deps.db, parsed.value.id);
  if (!before) return notFound('memberType', parsed.value.id);
  const used = deps.db.select({ n: count() }).from(memberTypePeriods).where(eq(memberTypePeriods.typeId, before.id)).get()?.n ?? 0;
  if (used > 0) return membersConflict('memberTypeInUse', { count: used });
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(memberTypes).where(eq(memberTypes.id, before.id)).run();
    recordAudit(tx, deps, ctx, { action: 'members.type.delete', entityType: 'memberType', entityId: before.id, before: { key: before.key, name: before.name }, params: { key: before.key } });
    return ok({ id: before.id });
  });
}

/**
 * Die nächste Aufnahme bekommt `next` — für Gründungsmitglieder mit vorhandenen Nummern (Handoff 2.6). Nur nach
 * vorn: Eine Nummer wird nie zweimal vergeben.
 */
export async function setNextMemberNumber(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ next: number }>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, nextMemberNumberSchema, input);
  if (!parsed.ok) return parsed;
  const last = lastMemberNumber(deps.db);
  if (parsed.value.next <= last) return membersConflict('memberNumberTooLow', { last });
  return deps.db.transaction((tx: DbOrTx) => {
    setLastMemberNumber(tx, parsed.value.next - 1);
    recordAudit(tx, deps, ctx, { action: 'members.numbers.setNext', entityType: 'memberNumber', entityId: null, before: { last }, after: { last: parsed.value.next - 1 }, params: { next: parsed.value.next } });
    return ok({ next: parsed.value.next });
  });
}
