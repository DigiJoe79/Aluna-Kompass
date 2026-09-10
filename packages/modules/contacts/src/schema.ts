import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Ein Kontakt ist entweder eine natürliche Person oder eine Organisation.
 * `belongsToId` bildet die dritte Sorte aus dem Alltag ab: eine Person bei
 * einer Organisation („Frau Klein, Sparkasse"). Welche Felder Pflicht sind,
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

export type ContactRow = typeof contacts.$inferSelect;
export type ContactChannelRow = typeof contactChannels.$inferSelect;
export type ContactRoleRow = typeof contactRoles.$inferSelect;
