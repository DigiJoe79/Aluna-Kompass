import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Die Klassifikation als Stammdaten, nicht als Konstanten (Prinzip 2). Die Art
 * trägt zweierlei, das sonst geraten werden müsste: das Nummernpräfix und die
 * Aufbewahrungsklasse.
 */
export const documentTypes = sqliteTable('document_types', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  prefix: text('prefix').notNull(), // drei Großbuchstaben
  defaultDirection: text('default_direction', { enum: ['outgoing', 'incoming'] }).notNull(),
  retentionClass: text('retention_class', { enum: ['permanent', 'statutory10Y', 'statutory6Y', 'consent'] }).notNull(),
  defaultFolder: text('default_folder'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Ordnungsbaum der Sachakte. Pfadtabelle wie `media_folders`. */
export const documentFolders = sqliteTable('document_folders', {
  path: text('path').primaryKey(), // 'behoerden', 'behoerden/finanzamt'
  createdAt: text('created_at').notNull(),
});

/** Einsortierhilfe: belegt das Formular vor, legt nie selbst ab (Entscheidung 19). */
export const documentRules = sqliteTable(
  'document_rules',
  {
    id: text('id').primaryKey(),
    matchField: text('match_field', { enum: ['filename', 'senderName'] }).notNull(),
    matchContains: text('match_contains').notNull(),
    thenTypeKey: text('then_type_key').references(() => documentTypes.key),
    thenFolder: text('then_folder'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('document_rules_sort_idx').on(t.sortOrder)],
);

export type DocumentTypeRow = typeof documentTypes.$inferSelect;
export type DocumentFolderRow = typeof documentFolders.$inferSelect;
export type DocumentRuleRow = typeof documentRules.$inferSelect;
