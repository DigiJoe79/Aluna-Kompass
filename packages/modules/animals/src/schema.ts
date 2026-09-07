import { localizedColumn, schema as core } from '@kompass/core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Kurzbegriffe je Sprache. Welche Sprachen, entscheidet die Installation. */
export type LocalizedList = Record<string, string[]>;

export const animals = sqliteTable(
  'animals',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    species: text('species').notNull().default('dog'),
    sex: text('sex', { enum: ['female', 'male'] }).notNull(),
    birthText: localizedColumn('birth_text'),
    sizeCm: integer('size_cm').notNull().default(0),
    sizeText: localizedColumn('size_text'),
    location: text('location', { enum: ['shelter', 'germany'] }).notNull().default('shelter'),
    status: text('status', { enum: ['lookingForHome', 'reserved', 'adopted'] }).notNull().default('lookingForHome'),
    isEmergency: integer('is_emergency', { mode: 'boolean' }).notNull().default(false),
    isSponsorable: integer('is_sponsorable', { mode: 'boolean' }).notNull().default(false),
    traits: text('traits', { mode: 'json' }).$type<LocalizedList>().notNull().default({}),
    externalProfileUrl: text('external_profile_url').notNull().default(''),
    summary: localizedColumn('summary'),
    body: localizedColumn('body'),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('animals_status_idx').on(t.status)],
);

export const animalPhotos = sqliteTable(
  'animal_photos',
  {
    animalId: text('animal_id').notNull().references(() => animals.id),
    assetId: text('asset_id').notNull().references(() => core.mediaAssets.id),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.animalId, t.assetId] })],
);

export const animalStories = sqliteTable('animal_stories', {
  animalId: text('animal_id').primaryKey().references(() => animals.id),
  beforeAssetId: text('before_asset_id').references(() => core.mediaAssets.id),
  afterAssetId: text('after_asset_id').references(() => core.mediaAssets.id),
  quote: localizedColumn('quote'),
  family: text('family').notNull().default(''),
  adoptedYear: integer('adopted_year').notNull(),
});
