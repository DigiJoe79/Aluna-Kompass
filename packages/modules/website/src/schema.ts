import { localizedColumn, schema as core, type LocalizedText } from '@kompass/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export interface PageBlock {
  id: string;
  title: LocalizedText;
  text: LocalizedText;
  imageAssetId: string | null;
  href: string;
  label: LocalizedText;
}

export const websitePages = sqliteTable('website_pages', {
  key: text('key').primaryKey(),
  title: localizedColumn('title'),
  lede: localizedColumn('lede'),
  body: localizedColumn('body'),
  metaDescription: localizedColumn('meta_description'),
  blocks: text('blocks', { mode: 'json' }).$type<PageBlock[]>().notNull().default([]),
  updatedAt: text('updated_at').notNull(),
});

export const websiteArticles = sqliteTable(
  'website_articles',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    title: localizedColumn('title'),
    lede: localizedColumn('lede'),
    body: localizedColumn('body'),
    publishedAt: text('published_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('website_articles_sort_idx').on(t.sortOrder)],
);

export const websiteTeam = sqliteTable('website_team', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: localizedColumn('position'),
  photoAssetId: text('photo_asset_id').references(() => core.mediaAssets.id),
  petPhotoAssetId: text('pet_photo_asset_id').references(() => core.mediaAssets.id),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const websiteFaqs = sqliteTable('website_faqs', {
  id: text('id').primaryKey(),
  category: localizedColumn('category'),
  question: localizedColumn('question'),
  answer: localizedColumn('answer'),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const websiteDownloads = sqliteTable('website_downloads', {
  key: text('key').primaryKey(),
  title: localizedColumn('title'),
  assetId: text('asset_id').references(() => core.mediaAssets.id),
  updatedAt: text('updated_at').notNull(),
});

export const websitePublishes = sqliteTable('website_publishes', {
  id: text('id').primaryKey(),
  environment: text('environment').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['success', 'failed', 'aborted'] }).notNull(),
  contentHash: text('content_hash').notNull().default(''),
  pagesChanged: integer('pages_changed').notNull().default(0),
  pagesAdded: integer('pages_added').notNull().default(0),
  pagesRemoved: integer('pages_removed').notNull().default(0),
  summary: text('summary').notNull().default(''),
  triggeredByUserId: text('triggered_by_user_id').references(() => core.users.id),
  log: text('log').notNull().default(''),
});
