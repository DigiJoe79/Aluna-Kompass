import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/** Die Variablen des aktiven Templates, ein Datensatz je Schlüssel. */
export const siteValues = sqliteTable('site_values', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Ein Eintrag einer Sammlung. `data` trägt die Felder des Templates. */
export const siteEntries = sqliteTable(
  'site_entries',
  {
    id: text('id').primaryKey(),
    collection: text('collection').notNull(),
    slug: text('slug'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('site_entries_collection').on(t.collection, t.sortOrder), unique('site_entries_slug').on(t.collection, t.slug)],
);

/** Der zuletzt eingelesene Stand: Vergleichsgrundlage und Publish-Sicherung. */
export const siteTemplateState = sqliteTable('site_template_state', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaJson: text('schema_json', { mode: 'json' }).notNull(),
  checksum: text('checksum').notNull(),
  readAt: text('read_at').notNull(),
  readByUserId: text('read_by_user_id'),
});
