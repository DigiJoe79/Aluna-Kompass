import { conflict, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentSnippets, type DocumentSnippetRow } from './schema';

const fields = {
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().trim().min(1).max(20_000),
  sortOrder: z.number().int().min(0).default(0),
};

export const snippetCreateSchema = z.object(fields);
export const snippetUpdateSchema = z.object({
  id: z.string().min(1),
  name: fields.name.optional(),
  subject: fields.subject,
  body: fields.body.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export const snippetIdSchema = z.object({ id: z.string().min(1) });
export const snippetListSchema = z.object({ includeInactive: z.boolean().default(false) });

const load = (db: DbOrTx, id: string) => db.select().from(documentSnippets).where(eq(documentSnippets.id, id)).get() ?? null;
const nameTaken = (db: DbOrTx, name: string, exceptId?: string) => {
  const row = db.select({ id: documentSnippets.id }).from(documentSnippets).where(eq(documentSnippets.name, name)).get();
  return !!row && row.id !== exceptId;
};

export async function createSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentSnippetRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetCreateSchema, input);
  if (!parsed.ok) return parsed;
  if (nameTaken(deps.db, parsed.value.name)) return conflict('snippetExists', `Baustein „${parsed.value.name}“ existiert bereits`);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(documentSnippets).values({ id, name: parsed.value.name, subject: parsed.value.subject ?? null, body: parsed.value.body, sortOrder: parsed.value.sortOrder, isActive: true }).run();
    const row = load(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.create', entityType: 'documentSnippet', entityId: id, after: { name: row.name, subject: row.subject }, summary: `Textbaustein „${row.name}“ angelegt` });
    return ok(row);
  });
}

export async function updateSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentSnippetRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('documentSnippet', id);
  if (changes.name !== undefined && nameTaken(deps.db, changes.name, id)) return conflict('snippetExists', `Baustein „${changes.name}“ existiert bereits`);
  const updates: Partial<typeof documentSnippets.$inferInsert> = {};
  if (changes.name !== undefined) updates.name = changes.name;
  if (changes.subject !== undefined) updates.subject = changes.subject;
  if (changes.body !== undefined) updates.body = changes.body;
  if (changes.sortOrder !== undefined) updates.sortOrder = changes.sortOrder;
  if (changes.isActive !== undefined) updates.isActive = changes.isActive;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documentSnippets).set(updates).where(eq(documentSnippets.id, id)).run();
    const after = load(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.update', entityType: 'documentSnippet', entityId: id, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive }, summary: `Textbaustein „${after.name}“ geändert` });
    return ok(after);
  });
}

export async function deleteSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('documentSnippet', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentSnippets).where(eq(documentSnippets.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.delete', entityType: 'documentSnippet', entityId: row.id, before: { name: row.name }, summary: `Textbaustein „${row.name}“ gelöscht` });
    return ok(null);
  });
}

export async function listSnippets(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<DocumentSnippetRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, snippetListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(documentSnippets).orderBy(asc(documentSnippets.sortOrder), asc(documentSnippets.name)).all();
  return ok(parsed.value.includeInactive ? rows : rows.filter((r) => r.isActive));
}
