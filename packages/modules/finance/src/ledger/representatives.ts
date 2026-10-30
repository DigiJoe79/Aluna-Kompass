import type { DbOrTx } from '@kompass/core';
import { contactRoles, contacts, displayName, userIdForContactInternal } from '@kompass/module-contacts';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';

/** Wer den Verein nach § 26 BGB vertritt (Ve-L-5): Name, Amt (Notiz der Rolle) und verknüpftes Konto, falls es eins gibt. */
export interface Representative {
  contactId: string;
  name: string;
  office: string | null;
  roleId: string;
  userId: string | null;
}

/**
 * Laufende Rollen `board-member` mit „vertritt nach § 26 BGB“ am Tag `on` (Beginn und Ende einschließlich), nach Name.
 * Ohne Rechteprüfung — für Dienste, die die Auswahl der Abzeichnenden brauchen.
 */
export function representativesInternal(db: DbOrTx, on: string): Representative[] {
  const rows = db
    .select({ role: contactRoles, contact: contacts })
    .from(contactRoles)
    .innerJoin(contacts, eq(contacts.id, contactRoles.contactId))
    .where(and(eq(contactRoles.role, 'board-member'), eq(contactRoles.representsAssociation, true), lte(contactRoles.since, on), or(isNull(contactRoles.until), gte(contactRoles.until, on))))
    .all();
  return rows
    .map(({ role, contact }) => ({ contactId: contact.id, name: displayName(contact), office: role.note, roleId: role.id, userId: userIdForContactInternal(db, contact.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.contactId.localeCompare(b.contactId));
}

/** Die vertretende Person hinter einem Nutzerkonto am Tag `on` — `null`, wenn das Konto niemanden vertritt. */
export function representativeOfUserInternal(db: DbOrTx, userId: string, on: string): Representative | null {
  return representativesInternal(db, on).find((r) => r.userId === userId) ?? null;
}
