import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { localizedColumn } from './columns';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: text('locked_until'),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  isProtected: integer('is_protected', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
  updatedAt: text('updated_at').notNull(),
  updatedByUserId: text('updated_by_user_id'),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: text('occurred_at').notNull(),
    userId: text('user_id'),
    channel: text('channel', { enum: ['ui', 'mcp', 'system'] }).notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: text('before'), // JSON
    after: text('after'), // JSON
    summary: text('summary').notNull(),
    apiTokenId: text('api_token_id'),
    ipAddress: text('ip_address'),
    requestId: text('request_id').notNull(),
    environment: text('environment').notNull(),
  },
  (t) => [
    index('audit_occurred_idx').on(t.occurredAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_user_idx').on(t.userId),
  ],
);

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  uploadedByUserId: text('uploaded_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull(),
  folder: text('folder'), // null = Wurzel; sonst ein Pfad aus media_folders
  /** Vollständige SHA-256, hexadezimal. Der Dateiname trägt nur die ersten zwölf Stellen. */
  checksum: text('checksum'),
});

/** Virtuelle Ordner der Mediathek. Die Dateien liegen flach unter MEDIA_PATH. */
export const mediaFolders = sqliteTable('media_folders', {
  path: text('path').primaryKey(), // 'tiere', 'tiere/2024' — kanonisch, '/'-getrennt
  createdAt: text('created_at').notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: localizedColumn('name'),
    type: text('type', { enum: ['ongoing', 'shortTerm'] }).notNull(),
    status: text('status', { enum: ['active', 'completed'] }).notNull().default('active'),
    summary: localizedColumn('summary'),
    body: localizedColumn('body'),
    imageAssetId: text('image_asset_id').references(() => mediaAssets.id),
    betterplaceProjectId: text('betterplace_project_id').notNull().default(''),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('projects_sort_idx').on(t.sortOrder)],
);

/**
 * Wiedervorlagen an beliebigen Entitäten — generischer Bezug wie in
 * `document_links`. Der Kern prüft die Entität nicht; das tut das Modul, das
 * die Wiedervorlage anlegt. Erledigt heißt abgehakt, nicht gelöscht: Die Zeile
 * bleibt, damit ein Vorgang zeigt, dass jemand nachgesehen hat.
 */
export const followUps = sqliteTable(
  'follow_ups',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** ISO-Datum. */
    dueAt: text('due_at').notNull(),
    title: text('title').notNull(),
    /** Leer heißt: alle. */
    assigneeUserId: text('assignee_user_id').references(() => users.id),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    doneAt: text('done_at'),
    doneByUserId: text('done_by_user_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('follow_ups_entity_idx').on(t.entityType, t.entityId), index('follow_ups_due_idx').on(t.doneAt, t.dueAt)],
);
