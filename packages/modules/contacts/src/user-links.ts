import { conflict, isoNow, newId, notFound, ok, recordAudit, requirePermission, schema, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { displayName } from './address';
import { contacts, contactUserLinks, type ContactUserLinkRow } from './schema';

export interface UserLinkChange {
  id: string;
  userId: string;
  contactId: string;
  linkedAt: string;
  linkedByUserId: string;
  unlinkedAt: string | null;
  unlinkedByUserId: string | null;
  /** Berechnet, nicht gespeichert: Das Konto hat sich selbst verknüpft. */
  selfLinked: boolean;
}

/** Ohne Rechteprüfung — für andere Module, die wissen müssen, wer ein Konto „ist“. */
export function contactIdForUserInternal(db: DbOrTx, userId: string): string | null {
  return db.select({ contactId: contactUserLinks.contactId }).from(contactUserLinks).where(and(eq(contactUserLinks.userId, userId), isNull(contactUserLinks.unlinkedAt))).get()?.contactId ?? null;
}

export function userIdForContactInternal(db: DbOrTx, contactId: string): string | null {
  return db.select({ userId: contactUserLinks.userId }).from(contactUserLinks).where(and(eq(contactUserLinks.contactId, contactId), isNull(contactUserLinks.unlinkedAt))).get()?.userId ?? null;
}

/** Jede Zeile, die im Zeitraum begann oder endete (Tagesgrenzen einschließlich), die älteste zuerst. */
export function userLinkChangesInternal(db: DbOrTx, range: { from: string; to: string }): UserLinkChange[] {
  const start = `${range.from}T00:00:00.000Z`;
  const end = `${range.to}T23:59:59.999Z`;
  return db
    .select()
    .from(contactUserLinks)
    .where(or(and(gte(contactUserLinks.linkedAt, start), lte(contactUserLinks.linkedAt, end)), and(gte(contactUserLinks.unlinkedAt, start), lte(contactUserLinks.unlinkedAt, end))))
    .orderBy(asc(contactUserLinks.linkedAt))
    .all()
    .map((row) => ({ ...row, selfLinked: row.linkedByUserId === row.userId }));
}

export const userLinkSchema = z.object({ userId: z.string().min(1), contactId: z.string().min(1) });
export const userIdSchema = z.object({ userId: z.string().min(1) });
export const userLinkRangeSchema = z.object({ from: z.string().date(), to: z.string().date() });

const SECOND_PERSON = 'Die eigene Verknüpfung ändert nur eine zweite Person mit dem Recht, Nutzer zu verwalten.';

/**
 * Das Recht ist `users.manage`, nicht `contacts.manage`: Die Verknüpfung ist
 * eine Aussage über ein Nutzerkonto — sie entscheidet später, wessen Auslage
 * wer freigeben darf.
 *
 * Die eigene Verknüpfung darf man **einmal** selbst setzen (ein Verein mit einem
 * Verwalter könnte sie sonst nie einrichten); jede weitere Änderung am eigenen
 * Konto braucht eine zweite Person. Das Protokoll nennt IDs, keine Namen.
 */
export async function linkUserToContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactUserLinkRow>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, userLinkSchema, input);
  if (!parsed.ok) return parsed;
  const { userId, contactId } = parsed.value;

  if (!deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get()) return notFound('user', userId);
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get()) return notFound('contact', contactId);

  return deps.db.transaction((tx: DbOrTx) => {
    if (contactIdForUserInternal(tx, userId)) return conflict('userAlreadyLinked', 'Dieses Nutzerkonto ist schon mit einem Kontakt verknüpft. Lösen Sie die Verknüpfung zuerst.');
    if (userIdForContactInternal(tx, contactId)) return conflict('contactAlreadyLinked', 'Dieser Kontakt ist schon mit einem Nutzerkonto verknüpft.');
    const hadOne = tx.select({ id: contactUserLinks.id }).from(contactUserLinks).where(eq(contactUserLinks.userId, userId)).get();
    if (ctx.userId !== null && ctx.userId === userId && hadOne) return conflict('ownLinkNeedsSecondPerson', SECOND_PERSON);

    const id = newId();
    tx.insert(contactUserLinks).values({ id, userId, contactId, linkedAt: isoNow(deps.clock), linkedByUserId: ctx.userId ?? 'system', unlinkedAt: null, unlinkedByUserId: null }).run();
    recordAudit(tx, deps, ctx, { action: 'contacts.userLink.create', entityType: 'contactUserLink', entityId: id, after: { userId, contactId, selfLinked: ctx.userId === userId }, summary: `Nutzerkonto ${userId} mit Kontakt ${contactId} verknüpft` });
    return ok(tx.select().from(contactUserLinks).where(eq(contactUserLinks.id, id)).get()!);
  });
}

export async function unlinkUser(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactUserLinkRow>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, userIdSchema, input);
  if (!parsed.ok) return parsed;
  const { userId } = parsed.value;

  return deps.db.transaction((tx: DbOrTx) => {
    const open = tx.select().from(contactUserLinks).where(and(eq(contactUserLinks.userId, userId), isNull(contactUserLinks.unlinkedAt))).get();
    if (!open) return conflict('userNotLinked', 'Dieses Nutzerkonto ist mit keinem Kontakt verknüpft.');
    if (ctx.userId !== null && ctx.userId === userId) return conflict('ownLinkNeedsSecondPerson', SECOND_PERSON);
    tx.update(contactUserLinks).set({ unlinkedAt: isoNow(deps.clock), unlinkedByUserId: ctx.userId ?? 'system' }).where(eq(contactUserLinks.id, open.id)).run();
    recordAudit(tx, deps, ctx, { action: 'contacts.userLink.end', entityType: 'contactUserLink', entityId: open.id, before: { userId, contactId: open.contactId }, summary: `Verknüpfung von Nutzerkonto ${userId} mit Kontakt ${open.contactId} gelöst` });
    return ok(tx.select().from(contactUserLinks).where(eq(contactUserLinks.id, open.id)).get()!);
  });
}

/** Für die Nutzerverwaltung: die offene Verknüpfung und der Name des Kontakts. */
export async function getUserLink(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ link: ContactUserLinkRow | null; contactName: string | null }>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, userIdSchema, input);
  if (!parsed.ok) return parsed;
  const link = deps.db.select().from(contactUserLinks).where(and(eq(contactUserLinks.userId, parsed.value.userId), isNull(contactUserLinks.unlinkedAt))).get() ?? null;
  const contact = link ? deps.db.select().from(contacts).where(eq(contacts.id, link.contactId)).get() : null;
  return ok({ link, contactName: contact ? displayName(contact) : null });
}

export async function listUserLinkChanges(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<UserLinkChange[]>> {
  const denied = requirePermission(ctx, 'users.manage');
  if (denied) return denied;
  const parsed = validate(deps, userLinkRangeSchema, input);
  if (!parsed.ok) return parsed;
  return ok(userLinkChangesInternal(deps.db, parsed.value));
}
