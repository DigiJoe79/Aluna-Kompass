import type { DbOrTx } from '@kompass/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { contactChannels, contacts } from './schema';

export const DELIVERY_PREFERENCES = ['auto', 'post'] as const;
export type DeliveryPreference = (typeof DELIVERY_PREFERENCES)[number];

export type ContactDelivery = { channel: 'email'; address: string; via: 'self' | 'organization' } | { channel: 'post'; reason: 'preference' | 'noEmail' };

/** Die E-Mail-Adresse eines Kontakts: die primäre, sonst die zuerst angelegte. */
function emailOf(db: DbOrTx, contactId: string): string | undefined {
  // `rowid` ist die Reihenfolge des Anlegens; `setContactChannels` legt in der Reihenfolge der Liste an.
  return db
    .select({ value: contactChannels.value })
    .from(contactChannels)
    .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.kind, 'email')))
    .orderBy(desc(contactChannels.isPrimary), sql`rowid`)
    .get()?.value;
}

/**
 * Wie ein Brief diesen Kontakt erreicht (Spec PDF per E-Mail § 4.1). `auto`
 * heißt E-Mail, wenn eine Adresse da ist: die primäre, sonst die zuerst
 * angelegte. Hat eine Person keine eigene und gehört sie zu einer
 * Organisation, gilt deren Adresse (`via: 'organization'`) — Empfänger bleibt
 * die Person. „Immer per Post“ der Person geht vor. Für Dienste anderer Module
 * in deren Transaktion, ohne Rechte — wer sie ruft, hat seine eigenen schon
 * geprüft.
 */
export function deliveryForContactInternal(db: DbOrTx, contactId: string): ContactDelivery {
  const contact = db.select({ preference: contacts.deliveryPreference }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (contact?.preference === 'post') return { channel: 'post', reason: 'preference' };
  return automaticDeliveryInternal(db, contactId);
}

/**
 * Was „Automatisch“ für diesen Kontakt ergibt, gleich was er gewählt hat — der
 * feste Wert „Zurzeit“ im Dialog (Handoff 2b E1), damit niemand rechnen muss.
 */
export function automaticDeliveryInternal(db: DbOrTx, contactId: string): ContactDelivery {
  const contact = db.select({ belongsToId: contacts.belongsToId }).from(contacts).where(eq(contacts.id, contactId)).get();
  const own = emailOf(db, contactId);
  if (own) return { channel: 'email', address: own, via: 'self' };
  const organization = contact?.belongsToId ? emailOf(db, contact.belongsToId) : undefined;
  return organization ? { channel: 'email', address: organization, via: 'organization' } : { channel: 'post', reason: 'noEmail' };
}
