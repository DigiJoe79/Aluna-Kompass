import type { DbOrTx, Deps } from '@kompass/core';
import { contacts, formatPostalAddress } from '@kompass/module-contacts';
import { and, eq } from 'drizzle-orm';
import { documentLinks } from './schema';

export function resolveRecipient(deps: Deps, documentId: string, dbOrTx: DbOrTx = deps.db): string {
  const link = dbOrTx
    .select()
    .from(documentLinks)
    .where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.role, 'recipient')))
    .get();

  if (!link || link.entityType !== 'contact') {
    return '';
  }

  const contact = dbOrTx.select().from(contacts).where(eq(contacts.id, link.entityId)).get();
  if (!contact) return '';

  let organisation = undefined;
  if (contact.belongsToId) {
    organisation = dbOrTx.select().from(contacts).where(eq(contacts.id, contact.belongsToId)).get() ?? undefined;
  }

  return formatPostalAddress(contact, organisation);
}
