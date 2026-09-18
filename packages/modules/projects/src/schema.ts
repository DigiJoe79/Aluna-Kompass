import { localizedColumn, schema as core } from '@kompass/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Ein Verweis nach aussen — Spendenseite, Bericht, Partner. Was ein Template daraus macht, entscheidet das Template. */
export interface ExternalLink {
  label: string;
  url: string;
}

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
    imageAssetId: text('image_asset_id').references(() => core.mediaAssets.id),
    externalLinks: text('external_links', { mode: 'json' }).$type<ExternalLink[]>().notNull().default([]),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('projects_sort_idx').on(t.sortOrder)],
);
