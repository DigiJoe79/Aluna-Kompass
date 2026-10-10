import { localizedColumn, schema as core, type LocalizedText } from '@kompass/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Kurzbegriffe je Sprache. Welche Sprachen, entscheidet die Installation. */
export type LocalizedList = Record<string, string[]>;

/** Ausschnitt eines Fotos: normiertes Rechteck (0–1) zum Bild, wie es angezeigt wird (EXIF-Drehung angewandt), vier Nachkommastellen. */
export interface PhotoCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const PROPOSAL_KINDS = ['create', 'update', 'notice', 'sameAs'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_STATES = ['open', 'accepted', 'acceptedWithChanges', 'rejected', 'replaced', 'withdrawn'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
/** Kennungen von Hinweisen, die eine eigene Folge haben (Spec Vorschlags-Eingang § 2). Wächst nur mit einer neuen Folge. */
export const NOTICE_KINDS = ['delisted'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** Zweifelsfall der Quelle (A5): mindestens `title` oder `field`. */
export interface ProposalHint {
  title?: string;
  field?: string;
  quote: string;
  suggestion: string;
}
export interface ProposalFinalPhoto {
  mediaId: string;
  sourceRef: string | null;
  position: number;
  isPrimary: boolean;
  crop: PhotoCrop | null;
}
/** Endfassung nach Annahme, für den Rückkanal (A27–A30). */
export interface ProposalFinal {
  animalId: string | null;
  values: Record<string, unknown>;
  photos: ProposalFinalPhoto[] | null;
  isPublished: boolean | null;
}

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
    /** Freitext, nicht lokalisiert: Land/Ort des Shelters oder Bundesland der Pflegestelle. */
    place: text('place').notNull().default(''),
    status: text('status', { enum: ['lookingForHome', 'reserved', 'adopted'] }).notNull().default('lookingForHome'),
    isEmergency: integer('is_emergency', { mode: 'boolean' }).notNull().default(false),
    isSponsorable: integer('is_sponsorable', { mode: 'boolean' }).notNull().default(false),
    traits: text('traits', { mode: 'json' }).$type<LocalizedList>().notNull().default({}),
    externalProfileUrl: text('external_profile_url').notNull().default(''),
    summary: localizedColumn('summary'),
    body: localizedColumn('body'),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    /** Gesetzt heißt: Prüfung offen, seit diesem Zeitpunkt. Ein Zustand, nicht ableitbar (Spec 2026-09-30, § 4). */
    reviewRequestedAt: text('review_requested_at'),
    /** Freitext des Anfordernden, was zu prüfen ist. Keine Personendaten. */
    reviewNote: text('review_note').notNull().default(''),
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
    /** Ausschnitt (Spec Vorschlags-Eingang § 2, A11); leer heißt ganzes Bild. Die Webseite nutzt ihn erst mit Backlog 24. */
    crop: text('crop', { mode: 'json' }).$type<PhotoCrop>(),
    /** Herkunft: die Quelle, deren Vorschlag das Foto brachte, und ihre Referenz — für den Rückkanal und „fällt weg“ in der Prüfung. */
    sourceUserId: text('source_user_id').references(() => core.users.id),
    sourceRef: text('source_ref'),
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
  /** Unterschrift unter dem Vorher- bzw. Nachher-Bild. Leer heißt: das Template zeigt keine Ortsangabe. */
  beforeCaption: text('before_caption', { mode: 'json' }).$type<LocalizedText>().notNull().default({}),
  afterCaption: text('after_caption', { mode: 'json' }).$type<LocalizedText>().notNull().default({}),
});

export const animalProposals = sqliteTable(
  'animal_proposals',
  {
    id: text('id').primaryKey(),
    /** Die Quelle ist der Dienstnutzer des Tokens; keine eigene Quellen-Tabelle (Spec Vorschlags-Eingang § 2). */
    sourceUserId: text('source_user_id')
      .notNull()
      .references(() => core.users.id),
    sourceKey: text('source_key').notNull(),
    kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
    /** Bewusst ohne Fremdschlüssel: bleibt nach dem Löschen des Tiers für den Rückkanal stehen. */
    animalId: text('animal_id'),
    externalRef: text('external_ref'),
    externalUrl: text('external_url'),
    trailUrl: text('trail_url'),
    /** Nach 90 Tagen geleert (`clearedAt`). */
    values: text('values', { mode: 'json' }).$type<Record<string, unknown>>(),
    hints: text('hints', { mode: 'json' }).$type<ProposalHint[]>(),
    baseline: text('baseline', { mode: 'json' }).$type<Record<string, unknown>>(),
    reason: text('reason'),
    noticeKind: text('notice_kind', { enum: NOTICE_KINDS }),
    state: text('state', { enum: PROPOSAL_STATES }).notNull().default('open'),
    decidedAt: text('decided_at'),
    decisionNote: text('decision_note'),
    /** Grund, den das System setzt (nicht ein Mensch): heute nur `animalDeleted`. */
    decisionReason: text('decision_reason', { enum: ['animalDeleted'] }),
    final: text('final', { mode: 'json' }).$type<ProposalFinal>(),
    sameAsAnswer: text('same_as_answer', { enum: ['same', 'different'] }),
    clearedAt: text('cleared_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('animal_proposals_source_key_idx').on(t.sourceUserId, t.sourceKey),
    // Je Tier und Quelle höchstens eine offene Änderung (A14); je Quelle und externer Kennung höchstens ein offener neuer Hund.
    uniqueIndex('animal_proposals_open_update_idx')
      .on(t.sourceUserId, t.animalId)
      .where(sql`${t.state} = 'open' and ${t.kind} = 'update'`),
    uniqueIndex('animal_proposals_open_create_idx')
      .on(t.sourceUserId, t.externalRef)
      .where(sql`${t.state} = 'open' and ${t.kind} = 'create'`),
    index('animal_proposals_state_idx').on(t.state, t.createdAt),
    index('animal_proposals_animal_idx').on(t.animalId),
  ],
);

/**
 * Bilder eines Vorschlags. Eine Zeile ist entweder eine bereitgestellte Datei in der Ablage des Moduls (`filename`,
 * bis zur Entscheidung) oder ein vorhandenes Foto des Tiers (`mediaId` ohne Datei). Ohne `proposalId` ist sie nur
 * bereitgestellt und nach 24 h weg (Spec Vorschlags-Eingang § 7).
 */
export const animalProposalImages = sqliteTable(
  'animal_proposal_images',
  {
    id: text('id').primaryKey(),
    sourceUserId: text('source_user_id')
      .notNull()
      .references(() => core.users.id),
    proposalId: text('proposal_id').references(() => animalProposals.id),
    /** Datei in `deps.files('animals')`; `null`, sobald sie gelöscht oder in die Mediathek übernommen ist. */
    filename: text('filename'),
    mimeType: text('mime_type'),
    bytes: integer('bytes'),
    width: integer('width'),
    height: integer('height'),
    checksum: text('checksum'),
    sourceRef: text('source_ref'),
    position: integer('position'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    crop: text('crop', { mode: 'json' }).$type<PhotoCrop>(),
    /** Vorhandenes Foto des Tiers (Eintrag ohne Datei) oder — nach Annahme — das Medium, zu dem die Datei wurde. Ohne Fremdschlüssel: Medien sind löschbar. */
    mediaId: text('media_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('animal_proposal_images_proposal_idx').on(t.proposalId),
    index('animal_proposal_images_staged_idx').on(t.sourceUserId, t.createdAt),
  ],
);

/** Woher ein Tier stammt: Quelle und Kennung dort (Spec Vorschlags-Eingang § 2). Entsteht bei Annahme, geht mit dem Tier. */
export const animalOrigins = sqliteTable(
  'animal_origins',
  {
    id: text('id').primaryKey(),
    animalId: text('animal_id')
      .notNull()
      .references(() => animals.id),
    sourceUserId: text('source_user_id')
      .notNull()
      .references(() => core.users.id),
    externalRef: text('external_ref').notNull(),
    externalUrl: text('external_url'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('animal_origins_source_ref_idx').on(t.sourceUserId, t.externalRef),
    index('animal_origins_animal_idx').on(t.animalId),
  ],
);
