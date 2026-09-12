import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

/** Regel zur Formularvorbelegung beim Einsortieren; legt nie selbst ab (Entscheidung 19). */
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

/**
 * Ein Eintrag ist eine Datei plus Metadaten — erzeugt oder eingegangen
 * (Entscheidung 5). Ein Entwurf hat weder Nummer noch Datei; er ist
 * Arbeitsmaterial und trägt seinen Text in `draftBody`.
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    phase: text('phase', { enum: ['draft', 'issued'] }).notNull().default('draft'),
    direction: text('direction', { enum: ['outgoing', 'incoming'] }).notNull().default('outgoing'),
    sourceKind: text('source_kind', { enum: ['generated', 'uploaded'] }).notNull().default('generated'),
    typeKey: text('type_key').notNull().references(() => documentTypes.key),
    number: text('number'),
    subject: text('subject').notNull().default(''),
    /** Datum **auf** dem Dokument; löst die Frist aus, nicht `createdAt`. */
    documentDate: text('document_date').notNull(),
    folder: text('folder'), // null = Eingangskorb
    /** Markdown des Entwurfs; beim Festschreiben geleert (Entscheidung 4). */
    draftBody: text('draft_body'),
    templateKey: text('template_key'),
    inputSnapshot: text('input_snapshot'), // JSON, nur `generated`
    /**
     * Die Datei im Speicher dieses Moduls (`deps.files('dms')`). Kein Dedupe
     * über den Inhalt wie in der Mediathek: Zwei inhaltsgleiche Schreiben an
     * verschiedene Empfänger sind zwei Vorgänge und zwei Dateien.
     */
    fileName: text('file_name'),
    fileChecksum: text('file_checksum'),
    fileBytes: integer('file_bytes'),
    /**
     * Zustand der Texterkennung — zugleich die Warteschlange (Entscheidung 24).
     * `null` für Entwürfe: Die haben keine Datei und also nichts zu lesen.
     *
     * `running` unterscheidet „liegt unter dem Werkzeug“ von „wartet“. Was nach
     * einem Neustart noch darauf steht, war ein Absturz; der Worker räumt es auf.
     */
    textStatus: text('text_status', { enum: ['pending', 'running', 'done', 'failed', 'unavailable'] }),
    textAttempts: integer('text_attempts').notNull().default(0),
    textError: text('text_error'),
    textExtractedAt: text('text_extracted_at'),
    /**
     * Der Versandvermerk (Entscheidung 34): alle drei zusammen gesetzt oder
     * zusammen leer. Nur an ausgehenden, festgeschriebenen Dokumenten. `sentVia`
     * ist ein Schlüssel aus der Einstellung `dms.dispatchChannels`; ein später
     * entfernter Weg bleibt hier als Schlüssel lesbar.
     */
    sentAt: text('sent_at'),
    sentVia: text('sent_via'),
    sentNote: text('sent_note'),
    status: text('status', { enum: ['issued', 'voided'] }).notNull().default('issued'),
    voidedAt: text('voided_at'),
    voidedByUserId: text('voided_by_user_id'),
    voidReason: text('void_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('documents_number_idx').on(t.number),
    index('documents_folder_idx').on(t.folder),
    index('documents_phase_idx').on(t.phase),
    index('documents_text_status_idx').on(t.textStatus),
  ],
);

/** Mehrere Bezüge je Dokument, jeder mit Rolle (Entscheidung 6). */
export const documentLinks = sqliteTable(
  'document_links',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id),
    /** Generisch wie bei `mediaReferences` — das Modul kennt keine fremden Entitäten. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    role: text('role', { enum: ['sender', 'recipient', 'about'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('document_links_unique_idx').on(t.documentId, t.entityType, t.entityId, t.role),
    index('document_links_entity_idx').on(t.entityType, t.entityId),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentLinkRow = typeof documentLinks.$inferSelect;

export const RELATION_KINDS = ['repliesTo', 'signedCopyOf', 'replaces', 'attachmentOf'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/**
 * Bezug zwischen zwei Dokumenten (Entscheidung 33). Gelesen von `documentId`
 * aus: „BEH-004 ist Antwort auf BRF-002“. Beide Enden dürfen Entwürfe sein.
 */
export const documentRelations = sqliteTable(
  'document_relations',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id),
    relatedDocumentId: text('related_document_id').notNull().references(() => documents.id),
    kind: text('kind', { enum: RELATION_KINDS }).notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('document_relations_unique_idx').on(t.documentId, t.relatedDocumentId, t.kind),
    index('document_relations_related_idx').on(t.relatedDocumentId),
  ],
);

/** Journal (Entscheidung 35): nur anhängen, nie ändern. Nie im PDF, nie im Index. */
export const documentNotes = sqliteTable(
  'document_notes',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id),
    body: text('body').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('document_notes_document_idx').on(t.documentId)],
);

/** Textbausteine ohne Platzhalter (Entscheidung 36). */
export const documentSnippets = sqliteTable(
  'document_snippets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('document_snippets_name_idx').on(t.name)],
);

/**
 * Nummernzähler je Präfix und Jahr (Entscheidung 38). Zustand, kein
 * abgeleiteter Wert: Er erinnert sich an Nummern, deren Dokument nicht mehr
 * da ist — genau dafür ist er da.
 */
export const documentCounters = sqliteTable(
  'document_counters',
  {
    prefix: text('prefix').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

export type DocumentRelationRow = typeof documentRelations.$inferSelect;
export type DocumentNoteRow = typeof documentNotes.$inferSelect;
export type DocumentSnippetRow = typeof documentSnippets.$inferSelect;
