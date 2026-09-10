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
    const hit = (col: SQLWrapper) => like(sqlLower(col), needle);
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

import { contactRoleDefinitions } from './roles';

export const contactChannelsSchema = z.object({
  id: z.string().min(1),
  channels: z
    .array(
      z.object({
        kind: z.enum(['email', 'phone', 'mobile', 'fax', 'web']),
        value: z.string().trim().min(1).max(200),
        label: z.string().trim().max(60).nullable().optional(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .max(20),
});

/** Ersetzt die Menge der Kommunikationswege — dasselbe Muster wie `setAnimalPhotos`. */
export async function setContactChannels(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactChannelsSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadContact(deps.db, parsed.value.id);
  if (!before) return notFound('contact', parsed.value.id);
  const marked = parsed.value.channels.filter((c) => c.isPrimary);
  if (marked.length > 1) return conflict('multiplePrimaryChannels', 'Es kann nur einen primären Kommunikationsweg geben');

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(contactChannels).where(eq(contactChannels.contactId, before.id)).run();
    parsed.value.channels.forEach((channel, index) => {
      tx.insert(contactChannels)
        .values({
          id: newId(),
          contactId: before.id,
          kind: channel.kind,
          value: channel.value,
          label: channel.label ?? null,
          // Ohne ausdrückliche Angabe ist der erste Weg der primäre.
          isPrimary: marked.length === 0 ? index === 0 : channel.isPrimary,
        })
        .run();
    });
    const after = loadContact(tx, before.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.setChannels', entityType: 'contact', entityId: after.id, before: before.channels, after: after.channels, summary: `Kommunikationswege von ${displayName(after)} geändert` });
    return ok(after);
  });
}

export const contactRoleAddSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  since: z.iso.date(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const contactRoleEndSchema = z.object({ roleId: z.string().min(1), until: z.iso.date() });

export async function addContactRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactRoleAddSchema, input);
  if (!parsed.ok) return parsed;
  // Die Rolle muss aus der Registry kommen, weil an ihr die Frist hängt.
  const known = contactRoleDefinitions(deps);
  if (!known.has(parsed.value.role)) {
    return validate(deps, z.object({ role: z.enum([...known.keys()] as [string, ...string[]]) }), { role: parsed.value.role }) as Result<ContactRecord>;
  }
  const contact = loadContact(deps.db, parsed.value.id);
  if (!contact) return notFound('contact', parsed.value.id);
  if (contact.roles.some((r) => r.role === parsed.value.role && r.until === null)) {
    return conflict('roleAlreadyRunning', `Die Rolle „${parsed.value.role}" läuft bereits`);
  }
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(contactRoles).values({ id: newId(), contactId: contact.id, role: parsed.value.role, since: parsed.value.since, until: null, note: parsed.value.note ?? null }).run();
    const after = loadContact(tx, contact.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.addRole', entityType: 'contact', entityId: after.id, after: { role: parsed.value.role, since: parsed.value.since }, summary: `Rolle ${parsed.value.role} für ${displayName(after)} begonnen` });
    return ok(after);
  });
}

/** Beendet eine Rolle. Die Zeile bleibt stehen — an ihr hängt die Frist. */
export async function endContactRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactRoleEndSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(contactRoles).where(eq(contactRoles.id, parsed.value.roleId)).get();
  if (!row) return notFound('contactRole', parsed.value.roleId);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contactRoles).set({ until: parsed.value.until }).where(eq(contactRoles.id, row.id)).run();
    const after = loadContact(tx, row.contactId)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.endRole', entityType: 'contact', entityId: after.id, before: { role: row.role, until: null }, after: { role: row.role, until: parsed.value.until }, summary: `Rolle ${row.role} für ${displayName(after)} beendet` });
    return ok(after);
  });
}

import { dueUntil, holdsFor, type DueItem, type RetentionHold } from '@kompass/core';
import { contactsRetentionDue } from './retention';

/** Bis wann dieser Kontakt gehalten wird — und von wem, damit man es nachlesen kann. */
export async function contactRetention(
  deps: Deps,
  ctx: CallContext,
  id: string,
): Promise<Result<{ holds: RetentionHold[]; until: string | null; due: boolean }>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const contact = deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) return notFound('contact', id);
  const holds = holdsFor(deps, 'contact', id);
  const until = dueUntil(holds);
  const today = deps.clock.now().toISOString().slice(0, 10);
  return ok({ holds, until, due: holds.length > 0 && until !== null && until < today });
}

export async function listDueContacts(deps: Deps, ctx: CallContext): Promise<Result<DueItem[]>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  return ok(contactsRetentionDue(deps));
}

export const contactDeleteSchema = z.object({ id: z.string().min(1) });

/**
 * Löscht einen Kontakt samt Rollen und Kommunikationswegen — aber erst, wenn
 * kein Halter mehr läuft. Was verschwindet, ist der Inhalt; dass jemand ihn
 * entfernt hat, bleibt im Änderungsprotokoll (Prinzip 3).
 */
export async function deleteContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const contact = loadContact(deps.db, parsed.value.id);
  if (!contact) return notFound('contact', parsed.value.id);

  const holds = holdsFor(deps, 'contact', contact.id);
  if (holds.length === 0) {
    return conflict('retentionUnknown', 'Für diesen Kontakt ist keine Frist nachgewiesen. Vergeben Sie eine Rolle oder archivieren Sie ihn.');
  }
  const until = dueUntil(holds);
  const today = deps.clock.now().toISOString().slice(0, 10);
  if (until === null || until >= today) {
    return conflict('retentionHoldActive', `Noch gehalten von: ${holds.map((h) => `${h.label}${h.until ? ` (bis ${h.until})` : ' (dauerhaft)'}`).join('; ')}`);
  }

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(contactChannels).where(eq(contactChannels.contactId, contact.id)).run();
    tx.delete(contactRoles).where(eq(contactRoles.contactId, contact.id)).run();
    tx.delete(contacts).where(eq(contacts.id, contact.id)).run();
    recordAudit(tx, deps, ctx, { action: 'contacts.delete', entityType: 'contact', entityId: contact.id, before: { name: displayName(contact), until }, summary: `Kontakt ${displayName(contact)} nach Fristablauf gelöscht` });
    return ok({ id: contact.id });
  });
}
