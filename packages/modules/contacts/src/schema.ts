import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Ein Kontakt ist entweder eine natürliche Person oder eine Organisation.
 * `belongsToId` bildet die dritte Sorte aus dem Alltag ab: eine Person bei
 * einer Organisation („Frau Klein, Sparkasse“). Welche Felder Pflicht sind,
 * entscheidet `kind` — geprüft wird das in Zod, nicht in der Tabelle, weil
 * SQLite keine bedingten Constraints kennt.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['person', 'organization'] }).notNull(),
    // Person
    salutation: text('salutation'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // Organisation
    name: text('name'),
    legalForm: text('legal_form'),
    // beide
    belongsToId: text('belongs_to_id').references((): AnySQLiteColumn => contacts.id),
    addressExtra: text('address_extra'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country'),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('contacts_status_idx').on(t.status), index('contacts_belongs_to_idx').on(t.belongsToId)],
);

/** Kommunikationswege. Mehrere je Kontakt; genau einer darf `isPrimary` sein. */
export const contactChannels = sqliteTable(
  'contact_channels',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    kind: text('kind', { enum: ['email', 'phone', 'mobile', 'fax', 'web'] }).notNull(),
    value: text('value').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('contact_channels_contact_idx').on(t.contactId)],
);

/**
 * Rollen über die Zeit. Eine Rolle endet über `until`; gelöscht wird sie nie,
 * weil an ihr die Aufbewahrungsfrist hängt.
 */
export const contactRoles = sqliteTable(
  'contact_roles',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: text('role').notNull(),
    since: text('since').notNull(),
    until: text('until'),
    note: text('note'),
  },
  (t) => [index('contact_roles_contact_idx').on(t.contactId), index('contact_roles_role_idx').on(t.role)],
);

/**
 * Welches Nutzerkonto welcher Kontakt ist — als **Verlauf** (Vorarbeiten-Spec
 * V5). Eine Zeile wird nie gelöscht und nie überschrieben: Lösen heißt beenden.
 * Ein Fachmodul muss später sagen können, wer im März mit wem verknüpft war,
 * als die Auslage freigegeben wurde.
 *
 * Bewusst ohne Fremdschlüssel: Der Verlauf überlebt den Kontakt. Ist ein
 * Kontakt nach seiner Frist gelöscht, bleibt die beendete Zeile mit seiner ID
 * stehen — sie trägt keine Personendaten, aber die Aussage „dieses Konto war
 * bis dahin verknüpft“. Dass es Konto und Kontakt gibt, prüft der Dienst.
 */
export const contactUserLinks = sqliteTable(
  'contacts_user_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    contactId: text('contact_id').notNull(),
    linkedAt: text('linked_at').notNull(),
    linkedByUserId: text('linked_by_user_id').notNull(),
    unlinkedAt: text('unlinked_at'),
    unlinkedByUserId: text('unlinked_by_user_id'),
  },
  (t) => [
    // Eindeutig ist je Richtung nur die **offene** Zeile.
    uniqueIndex('contacts_user_links_open_user_idx').on(t.userId).where(sql`${t.unlinkedAt} is null`),
    uniqueIndex('contacts_user_links_open_contact_idx').on(t.contactId).where(sql`${t.unlinkedAt} is null`),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type ContactChannelRow = typeof contactChannels.$inferSelect;
export type ContactRoleRow = typeof contactRoles.$inferSelect;
export type ContactUserLinkRow = typeof contactUserLinks.$inferSelect;
