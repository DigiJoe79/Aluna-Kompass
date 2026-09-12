import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { followUps, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { validate } from '../validate';

export type FollowUpRecord = typeof followUps.$inferSelect;

const ENTITY = z.string().trim().min(1).max(60);

export const followUpCreateSchema = z.object({
  entityType: ENTITY,
  entityId: z.string().trim().min(1),
  dueAt: z.string().date(),
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().trim().min(1).nullable().optional(),
});

export const followUpIdSchema = z.object({ id: z.string().min(1) });

export const followUpListSchema = z.object({
  entityType: ENTITY,
  entityId: z.string().trim().min(1),
  includeDone: z.boolean().default(false),
});

export const followUpDueSchema = z.object({
  until: z.string().date(),
  assigneeUserId: z.string().trim().min(1).optional(),
});

function load(db: DbOrTx, id: string): FollowUpRecord | null {
  return db.select().from(followUps).where(eq(followUps.id, id)).get() ?? null;
}

/**
 * Der Kern prüft die Entität nicht — er kennt sie nicht. Wer eine Wiedervorlage
 * anlegt, hat vorher geprüft, dass es den Vorgang gibt und dass er ihn sehen
 * darf (in der Akte: `createDocumentFollowUp`).
 */
export async function createFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  if (v.assigneeUserId) {
    const user = deps.db.select({ id: users.id }).from(users).where(eq(users.id, v.assigneeUserId)).get();
    if (!user) return notFound('user', v.assigneeUserId);
  }

  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(followUps)
      .values({
        id,
        entityType: v.entityType,
        entityId: v.entityId,
        dueAt: v.dueAt,
        title: v.title,
        assigneeUserId: v.assigneeUserId ?? null,
        createdByUserId: ctx.userId ?? 'system',
        createdAt: now,
        doneAt: null,
        doneByUserId: null,
        updatedAt: now,
      })
      .run();
    const record = load(tx, id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.create',
      entityType: 'followUp',
      entityId: id,
      after: record,
      summary: `Wiedervorlage „${v.title}“ zum ${v.dueAt} angelegt`,
    });
    return ok(record);
  });
}

export async function completeFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);
  if (row.doneAt) return conflict('followUpDone', `Wiedervorlage „${row.title}“ ist bereits erledigt`);

  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(followUps).set({ doneAt: now, doneByUserId: ctx.userId, updatedAt: now }).where(eq(followUps.id, row.id)).run();
    const after = load(tx, row.id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.complete',
      entityType: 'followUp',
      entityId: row.id,
      before: { doneAt: null },
      after: { doneAt: now },
      summary: `Wiedervorlage „${row.title}“ erledigt`,
    });
    return ok(after);
  });
}

export async function reopenFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);
  if (!row.doneAt) return conflict('followUpOpen', `Wiedervorlage „${row.title}“ ist noch offen`);

  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(followUps).set({ doneAt: null, doneByUserId: null, updatedAt: now }).where(eq(followUps.id, row.id)).run();
    const after = load(tx, row.id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.reopen',
      entityType: 'followUp',
      entityId: row.id,
      before: { doneAt: row.doneAt },
      after: { doneAt: null },
      summary: `Wiedervorlage „${row.title}“ wieder geöffnet`,
    });
    return ok(after);
  });
}

export async function deleteFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);

  return deps.db.transaction((tx) => {
    tx.delete(followUps).where(eq(followUps.id, row.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'followUps.delete',
      entityType: 'followUp',
      entityId: row.id,
      before: row,
      summary: `Wiedervorlage „${row.title}“ gelöscht`,
    });
    return ok(null);
  });
}

export async function listFollowUps(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord[]>> {
  const denied = requirePermission(ctx, 'followUps.view');
  if (denied) return denied;
  const parsed = validate(deps, followUpListSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const scope = and(eq(followUps.entityType, q.entityType), eq(followUps.entityId, q.entityId));
  const open = deps.db.select().from(followUps).where(and(scope, isNull(followUps.doneAt))).orderBy(asc(followUps.dueAt), asc(followUps.createdAt)).all();
  if (!q.includeDone) return ok(open);
  const done = deps.db.select().from(followUps).where(and(scope, sql`${followUps.doneAt} is not null`)).orderBy(desc(followUps.doneAt)).all();
  return ok([...open, ...done]);
}

export async function listDueFollowUps(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord[]>> {
  const denied = requirePermission(ctx, 'followUps.view');
  if (denied) return denied;
  const parsed = validate(deps, followUpDueSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions = [isNull(followUps.doneAt), lte(followUps.dueAt, q.until)];
  if (q.assigneeUserId) conditions.push(eq(followUps.assigneeUserId, q.assigneeUserId));
  const rows = deps.db.select().from(followUps).where(and(...conditions)).orderBy(asc(followUps.dueAt), asc(followUps.createdAt)).all();
  return ok(rows);
}

/**
 * Für Module, die ihre Entität löschen: räumt alle Wiedervorlagen daran weg,
 * auch die erledigten. Läuft in der Transaktion des Aufrufers und schreibt
 * keinen eigenen Protokolleintrag — der Eintrag des Moduls nennt die Zahl.
 */
export function deleteFollowUpsFor(tx: DbOrTx, entityType: string, entityId: string): number {
  const result = tx.delete(followUps).where(and(eq(followUps.entityType, entityType), eq(followUps.entityId, entityId))).run();
  return result.changes;
}
