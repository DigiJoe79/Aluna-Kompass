import {
  conflict, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate,
  type CallContext, type DbOrTx, type Deps, type Result,
} from '@kompass/core';
import { and, count, desc, eq, like, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';
import { displayName } from './address';
import { contactChannels, contactRoles, contacts, type ContactChannelRow, type ContactRoleRow, type ContactRow } from './schema';

/** `lower()` in SQL, damit die Suche auch Umlaute in Großschreibung findet. */
const sqlLower = (col: SQLWrapper) => sql<string>`lower(${col})`;

export type ContactRecord = ContactRow & {
  channels: ContactChannelRow[];
  roles: ContactRoleRow[];
  belongsTo: ContactRow | null;
};

function loadContact(db: DbOrTx, id: string): ContactRecord | null {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return null;
  return {
    ...row,
    channels: db.select().from(contactChannels).where(eq(contactChannels.contactId, id)).all(),
    roles: db.select().from(contactRoles).where(eq(contactRoles.contactId, id)).all(),
    belongsTo: row.belongsToId ? (db.select().from(contacts).where(eq(contacts.id, row.belongsToId)).get() ?? null) : null,
  };
}

const address = {
  belongsToId: z.string().min(1).nullable().optional(),
  addressExtra: z.string().trim().max(200).nullable().optional(),
  street: z.string().trim().max(200).nullable().optional(),
  postalCode: z.string().trim().max(10).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
};

/**
 * Person und Organisation sind zwei Varianten desselben Kontakts. Welche Felder
 * Pflicht sind, entscheidet `kind` — deshalb eine Union statt eines Schemas mit
 * lauter optionalen Feldern.
 */
export const contactCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('person'),
    salutation: z.string().trim().max(60).nullable().optional(),
    firstName: z.string().trim().max(120).nullable().optional(),
    lastName: z.string().trim().min(1).max(120),
    ...address,
  }),
  z.object({
    kind: z.literal('organization'),
    name: z.string().trim().min(1).max(200),
    legalForm: z.string().trim().max(120).nullable().optional(),
    ...address,
  }),
]);

export const contactUpdateSchema = z.object({
  id: z.string().min(1),
  salutation: z.string().trim().max(60).nullable().optional(),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  legalForm: z.string().trim().max(120).nullable().optional(),
  ...address,
});

export const contactStatusSchema = z.object({ id: z.string().min(1), status: z.enum(['active', 'archived']) });

export const contactListSchema = z.object({
  kind: z.enum(['person', 'organization']).optional(),
  role: z.string().min(1).optional(),
  text: z.string().trim().min(1).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `belongsTo` darf nur auf eine Organisation zeigen und nie auf den Kontakt selbst. */
function belongsToProblem(db: DbOrTx, belongsToId: string | null | undefined, selfId?: string): Result<null> | null {
  if (!belongsToId) return null;
  if (belongsToId === selfId) return conflict('belongsToNotAnOrganization', 'Ein Kontakt kann nicht bei sich selbst sitzen');
  const target = db.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, belongsToId)).get();
  if (!target) return notFound('contact', belongsToId);
  if (target.kind !== 'organization') return conflict('belongsToNotAnOrganization', 'Zugehörigkeit ist nur zu einer Organisation möglich');
  return null;
}

export async function createContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactCreateSchema, input);
  if (!parsed.ok) return parsed;
  const problem = belongsToProblem(deps.db, parsed.value.belongsToId);
  if (problem) return problem as Result<ContactRecord>;
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(contacts).values({ id, ...parsed.value, status: 'active', createdAt: now, updatedAt: now }).run();
    const record = loadContact(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.create', entityType: 'contact', entityId: id, after: record, summary: `Kontakt ${displayName(record)} angelegt` });
    return ok(record);
  });
}

export async function updateContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = loadContact(deps.db, id);
  if (!before) return notFound('contact', id);
  const problem = belongsToProblem(deps.db, changes.belongsToId, id);
  if (problem) return problem as Result<ContactRecord>;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contacts).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(contacts.id, id)).run();
    const after = loadContact(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.update', entityType: 'contact', entityId: id, before, after, summary: `Kontakt ${displayName(after)} geändert` });
    return ok(after);
  });
}

export async function setContactStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactStatusSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadContact(deps.db, parsed.value.id);
  if (!before) return notFound('contact', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contacts).set({ status: parsed.value.status, updatedAt: isoNow(deps.clock) }).where(eq(contacts.id, parsed.value.id)).run();
    const after = loadContact(tx, parsed.value.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.setStatus', entityType: 'contact', entityId: after.id, before: { status: before.status }, after: { status: after.status }, summary: `Kontakt ${displayName(after)} ${after.status === 'archived' ? 'archiviert' : 'reaktiviert'}` });
    return ok(after);
  });
}

export async function getContact(deps: Deps, ctx: CallContext, id: string): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const record = loadContact(deps.db, id);
  return record ? ok(record) : notFound('contact', id);
}

export async function listContacts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ contacts: ContactRecord[]; total: number }>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const parsed = validate(deps, contactListSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;

  const conditions: SQL[] = [];
  if (!q.includeArchived) conditions.push(eq(contacts.status, 'active'));
  if (q.kind) conditions.push(eq(contacts.kind, q.kind));
  if (q.text) {
    // SQLite `like` ist bei ASCII ohnehin case-insensitive; für Umlaute reicht
    // das nicht, deshalb wird zusätzlich klein geschrieben verglichen.
    const needle = `%${q.text.toLowerCase()}%`;
    const hit = (col: typeof contacts.lastName) => like(sqlLower(col), needle);
    conditions.push(or(hit(contacts.lastName), hit(contacts.firstName), hit(contacts.name), hit(contacts.city))!);
  }
  if (q.role) {
    const ids = deps.db.select({ id: contactRoles.contactId }).from(contactRoles).where(eq(contactRoles.role, q.role)).all().map((r) => r.id);
    if (ids.length === 0) return ok({ contacts: [], total: 0 });
    conditions.push(or(...ids.map((id) => eq(contacts.id, id)))!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total = deps.db.select({ n: count() }).from(contacts).where(where).get()?.n ?? 0;
  const rows = deps.db.select({ id: contacts.id }).from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(q.limit).offset(q.offset).all();
  return ok({ contacts: rows.map((r) => loadContact(deps.db, r.id)!), total });
}
