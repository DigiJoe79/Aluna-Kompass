import type { DbOrTx } from '@kompass/core';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { contactUserLinks } from './schema';

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
