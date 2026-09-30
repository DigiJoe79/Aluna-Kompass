import { buildDeletionPreview, conflict, expectedVersionField, staleVersion, deleteUnreferencedMedia, deletionConflict, emptyLocalized, invalid, isoNow, localizedList as coreLocalizedList, localizedText, newId, notFound, notifyRecordDeleted, ok, recordAudit, requirePermission, schema as core, validate, type CallContext, type DbOrTx, type DeletionPreview, type Deps, type LocalizedText, type MediaCleanup, type Result } from '@kompass/core';
import { and, asc, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { animalPhotos, animalStories, animals, type LocalizedList } from './schema';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const localizedList = coreLocalizedList({ max: 12, itemMax: 40 });

export interface AnimalPhoto { assetId: string; sortOrder: number; isPrimary: boolean }
export interface AnimalStory { beforeAssetId: string | null; afterAssetId: string | null; quote: LocalizedText; family: string; adoptedYear: number; beforeCaption: LocalizedText; afterCaption: LocalizedText }
export type AnimalRecord = typeof animals.$inferSelect & { photos: AnimalPhoto[]; story: AnimalStory | null };

const fields = {
  slug: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(80),
  sex: z.enum(['female', 'male']),
  birthText: localizedText({ max: 60 }),
  sizeCm: z.number().int().min(0).max(120).default(0),
  sizeText: localizedText({ max: 80 }),
  location: z.enum(['shelter', 'germany']).default('shelter'),
  place: z.string().trim().max(120).default(''),
  isEmergency: z.boolean().default(false),
  isSponsorable: z.boolean().default(false),
  traits: localizedList.default({}),
  externalProfileUrl: z.union([z.literal(''), z.url()]).default(''),
  summary: localizedText({ max: 300 }),
  body: localizedText({ max: 20_000 }),
};
export const animalCreateSchema = z.object(fields);
// Beim Update zählt nur, was genannt ist. `.default()` greift in Zod 4 auch
// hinter `.optional()` — ohne `removeDefault()` setzte ein Update mit einem
// einzigen Feld Größe, Standort, Notfall und Patenschaft auf die Vorgabe zurück.
export const animalUpdateSchema = z.object({
  id: z.string().min(1),
  slug: fields.slug.optional(),
  name: fields.name.optional(),
  sex: fields.sex.optional(),
  birthText: fields.birthText.optional(),
  sizeCm: fields.sizeCm.removeDefault().optional(),
  sizeText: fields.sizeText.optional(),
  location: fields.location.removeDefault().optional(),
  place: fields.place.removeDefault().optional(),
  isEmergency: fields.isEmergency.removeDefault().optional(),
  isSponsorable: fields.isSponsorable.removeDefault().optional(),
  traits: localizedList.optional(),
  externalProfileUrl: fields.externalProfileUrl.removeDefault().optional(),
  summary: fields.summary.optional(),
  body: fields.body.optional(),
  /** Ladestand der Maske (`updatedAt`); veraltet → `staleVersion`. */
  expectedVersion: expectedVersionField,
});

export function loadAnimal(db: DbOrTx, id: string): AnimalRecord | null {
  const row = db.select().from(animals).where(eq(animals.id, id)).get();
  if (!row) return null;
  const photos = db.select({ assetId: animalPhotos.assetId, sortOrder: animalPhotos.sortOrder, isPrimary: animalPhotos.isPrimary }).from(animalPhotos).where(eq(animalPhotos.animalId, id)).orderBy(asc(animalPhotos.sortOrder)).all();
  const story = db.select().from(animalStories).where(eq(animalStories.animalId, id)).get();
  return { ...row, traits: row.traits as LocalizedList, photos, story: story ? { beforeAssetId: story.beforeAssetId, afterAssetId: story.afterAssetId, quote: story.quote, family: story.family, adoptedYear: story.adoptedYear, beforeCaption: story.beforeCaption, afterCaption: story.afterCaption } : null };
}

const slugTaken = (db: DbOrTx, slug: string, exceptId?: string) => { const r = db.select({ id: animals.id }).from(animals).where(eq(animals.slug, slug)).get(); return !!r && r.id !== exceptId; };
const imageMime = (db: DbOrTx, id: string): 'missing' | 'notImage' | 'ok' => { const m = db.select({ mime: core.mediaAssets.mimeType }).from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get()?.mime; return !m ? 'missing' : m.startsWith('image/') ? 'ok' : 'notImage'; };

/** Was ein Agent schreibt, ist ein Vorschlag, bis ein Mensch ihn gesehen hat (Spec 2026-09-30, § 5.1). Der erste Zeitpunkt bleibt: Die Warteschlange sortiert nach ihm. */
function markReviewPending(tx: DbOrTx, deps: Deps, ctx: CallContext, id: string): void {
  if (ctx.channel !== 'mcp') return;
  const row = tx.select({ name: animals.name, reviewRequestedAt: animals.reviewRequestedAt, reviewNote: animals.reviewNote }).from(animals).where(eq(animals.id, id)).get();
  if (!row || row.reviewRequestedAt) return;
  const now = isoNow(deps.clock);
  tx.update(animals).set({ reviewRequestedAt: now }).where(and(eq(animals.id, id), isNull(animals.reviewRequestedAt))).run();
  // Jedes Vormerken hat seinen eigenen Eintrag, dieselbe Aktion wie das ausdrückliche Anfordern: Die Einträge
  // zu Fotos und Geschichte protokollieren nur ihren Inhalt, der Merker stünde dort sonst nirgends. Er steht
  // vor dem Eintrag der Änderung, die ihn ausgelöst hat.
  recordAudit(tx, deps, ctx, { action: 'animals.requestReview', entityType: 'animal', entityId: id, before: { reviewRequestedAt: null, reviewNote: row.reviewNote }, after: { reviewRequestedAt: now, reviewNote: row.reviewNote }, summary: `${row.name} zur Prüfung vorgemerkt (Schreiben über MCP)` });
}

export async function createAnimal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalCreateSchema, input);
  if (!parsed.ok) return parsed;
  if (slugTaken(deps.db, parsed.value.slug)) return conflict('slugTaken', `Slug ${parsed.value.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(animals).values({ id, ...parsed.value, species: 'dog', status: 'lookingForHome', isPublished: false, createdAt: now, updatedAt: now }).run();
    markReviewPending(tx, deps, ctx, id);
    const record = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.create', entityType: 'animal', entityId: id, after: record, summary: `Tier ${record.name} angelegt` });
    return ok(record);
  });
}

export async function updateAnimal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, ...changes } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    markReviewPending(tx, deps, ctx, id);
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.update', entityType: 'animal', entityId: id, before, after, summary: `Tier ${after.name} geändert` });
    return ok(after);
  });
}

export const animalStatusSchema = z.object({ id: z.string().min(1), status: z.enum(['lookingForHome', 'reserved', 'adopted']), adoptedYear: z.number().int().min(2000).max(2100).optional() });

export async function setAnimalStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalStatusSchema, input);
  if (!parsed.ok) return parsed;
  const { id, status, adoptedYear } = parsed.value;
  if (status === 'adopted' && adoptedYear === undefined) return invalid([{ path: 'adoptedYear', message: 'required' }]);
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ status, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    if (status === 'adopted' && !before.story) {
      tx.insert(animalStories).values({ animalId: id, beforeAssetId: null, afterAssetId: null, quote: emptyLocalized(deps.locales()), family: '', adoptedYear: adoptedYear as number }).run();
    }
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setStatus', entityType: 'animal', entityId: id, before: { status: before.status }, after: { status, adoptedYear: adoptedYear ?? null }, summary: `Status von ${after.name}: ${status}` });
    return ok(after);
  });
}

export const animalPhotosSchema = z.object({ id: z.string().min(1), photos: z.array(z.object({ assetId: z.string().min(1), isPrimary: z.boolean().default(false) })).max(12) });

export async function setAnimalPhotos(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalPhotosSchema, input);
  if (!parsed.ok) return parsed;
  const { id, photos } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (photos.filter((p) => p.isPrimary).length > 1) return invalid([{ path: 'photos', message: 'multiplePrimary' }]);
  for (const [i, p] of photos.entries()) {
    const state = imageMime(deps.db, p.assetId);
    if (state === 'missing') return notFound('mediaAsset', p.assetId);
    if (state === 'notImage') return invalid([{ path: `photos.${i}.assetId`, message: 'notAnImage' }]);
  }
  return deps.db.transaction((tx) => {
    tx.delete(animalPhotos).where(eq(animalPhotos.animalId, id)).run(); // Zuordnung, kein Rechenschaftsdatum; Assets bleiben
    photos.forEach((p, i) => tx.insert(animalPhotos).values({ animalId: id, assetId: p.assetId, sortOrder: i + 1, isPrimary: p.isPrimary || (i === 0 && !photos.some((x) => x.isPrimary)) }).run());
    // Ohne das wäre „zuletzt geändert“ falsch, und der Ladestand einer Maske sähe einen Fototausch nicht.
    tx.update(animals).set({ updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    markReviewPending(tx, deps, ctx, id);
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setPhotos', entityType: 'animal', entityId: id, before: before.photos, after: after.photos, summary: `Fotos von ${after.name} geändert` });
    return ok(after);
  });
}

export const animalStorySchema = z.object({
  id: z.string().min(1),
  beforeAssetId: z.string().nullable(),
  afterAssetId: z.string().nullable(),
  quote: localizedText({ max: 600 }),
  family: z.string().trim().max(120),
  adoptedYear: z.number().int().min(2000).max(2100),
  // Ohne Vorgabe: Wer die Bildunterschriften nicht nennt — ältere Aufrufer,
  // ein Agent, der nur das Zitat ändert —, lässt sie stehen. Mit `.default({})`
  // leerte jeder solche Aufruf beide (2026-09-19, tests/mcp-schemas.test.ts).
  beforeCaption: localizedText({ max: 200 }).optional(),
  afterCaption: localizedText({ max: 200 }).optional(),
  /** Ladestand des Tiers (`updatedAt`); veraltet → `staleVersion`. */
  expectedVersion: expectedVersionField,
});

export async function setAnimalStory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalStorySchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, beforeCaption, afterCaption, ...rest } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (before.status !== 'adopted') return conflict('animalNotAdopted', 'Eine Erfolgsgeschichte gibt es nur für vermittelte Tiere');
  const story = {
    ...rest,
    beforeCaption: beforeCaption ?? before.story?.beforeCaption ?? {},
    afterCaption: afterCaption ?? before.story?.afterCaption ?? {},
  };
  for (const assetId of [story.beforeAssetId, story.afterAssetId]) {
    if (!assetId) continue;
    const state = imageMime(deps.db, assetId);
    if (state === 'missing') return notFound('mediaAsset', assetId);
    if (state === 'notImage') return invalid([{ path: 'beforeAssetId', message: 'notAnImage' }]);
  }
  return deps.db.transaction((tx) => {
    tx.insert(animalStories).values({ animalId: id, ...story }).onConflictDoUpdate({ target: animalStories.animalId, set: story }).run();
    tx.update(animals).set({ updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    markReviewPending(tx, deps, ctx, id);
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setStory', entityType: 'animal', entityId: id, before: before.story, after: after.story, summary: `Erfolgsgeschichte von ${after.name} geändert` });
    return ok(after);
  });
}

export async function setAnimalPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = loadAnimal(deps.db, parsed.value.id);
  if (!before) return notFound('animal', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, before.id)).run();
    const after = loadAnimal(tx, before.id)!;
    recordAudit(tx, deps, ctx, { action: after.isPublished ? 'animals.publish' : 'animals.unpublish', entityType: 'animal', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `${after.name} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

export const animalReviewRequestSchema = z.object({ id: z.string().min(1), note: z.string().trim().max(500).default('') });

/**
 * Merkt ein Profil zur Prüfung vor und sagt, was zu prüfen ist (Spec 2026-09-30,
 * § 5.2). Der Weg für die Notiz zum Vorschlag und für Fälle ohne
 * Inhaltsänderung. Ein schon gesetzter Zeitpunkt bleibt, die Notiz wird ersetzt.
 */
export async function requestAnimalReview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalReviewRequestSchema, input);
  if (!parsed.ok) return parsed;
  const { id, note } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(animals).set({ reviewRequestedAt: before.reviewRequestedAt ?? now, reviewNote: note, updatedAt: now }).where(eq(animals.id, id)).run();
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.requestReview', entityType: 'animal', entityId: id, before: { reviewRequestedAt: before.reviewRequestedAt, reviewNote: before.reviewNote }, after: { reviewRequestedAt: after.reviewRequestedAt, reviewNote: after.reviewNote }, summary: `Prüfung für ${after.name} angefordert` });
    return ok(after);
  });
}

export const animalReviewConfirmSchema = z.object({ id: z.string().min(1), expectedVersion: z.string().min(1), publish: z.boolean().default(false) });

/**
 * Nimmt den Prüfmerker zurück (Spec 2026-09-30, § 5.3) — nur in der Oberfläche:
 * Über MCP prüfte der Agent seinen eigenen Vorschlag. Der Ladestand ist hier
 * Pflicht; hat der Agent seit dem Laden der Maske geschrieben, würde sonst
 * etwas bestätigt, das niemand gesehen hat. Mit `publish` wird ein
 * unveröffentlichtes Profil im selben Zug veröffentlicht, mit eigenem
 * Protokolleintrag, damit die Spur der Veröffentlichungen filterbar bleibt.
 */
export async function confirmAnimalReview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  if (ctx.channel === 'mcp') return conflict('reviewUiOnly', 'Die Prüfung bestätigt ein Mensch in der Oberfläche');
  const parsed = validate(deps, animalReviewConfirmSchema, input);
  if (!parsed.ok) return parsed;
  const { id, expectedVersion, publish } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (!before.reviewRequestedAt) return conflict('noReviewPending', 'Für dieses Profil ist keine Prüfung offen');
  const publishNow = publish && !before.isPublished;
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ reviewRequestedAt: null, reviewNote: '', updatedAt: isoNow(deps.clock), ...(publishNow ? { isPublished: true } : {}) }).where(eq(animals.id, id)).run();
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.confirmReview', entityType: 'animal', entityId: id, before: { reviewRequestedAt: before.reviewRequestedAt, reviewNote: before.reviewNote }, after: { reviewRequestedAt: null, reviewNote: '' }, summary: `Prüfung für ${after.name} bestätigt` });
    if (publishNow) recordAudit(tx, deps, ctx, { action: 'animals.publish', entityType: 'animal', entityId: id, before: { isPublished: false }, after: { isPublished: true }, summary: `${after.name} veröffentlicht` });
    return ok(after);
  });
}

export const animalListSchema = z.object({
  text: z.string().trim().max(80).optional(),
  status: z.enum(['lookingForHome', 'reserved', 'adopted']).optional(),
  location: z.enum(['shelter', 'germany']).optional(),
  isPublished: z.boolean().optional(),
  reviewPending: z.boolean().optional(),
  orderBy: z.object({ field: z.enum(['name', 'createdAt', 'updatedAt', 'reviewRequestedAt']), direction: z.enum(['asc', 'desc']).default('asc') }).optional(),
});
export type AnimalListInput = z.input<typeof animalListSchema>;
/** Eine knappe Zeile der Liste: ohne Texte, Fotos und Geschichte. Das volle Profil liefert `getAnimal`. */
export interface AnimalListItem { id: string; slug: string; name: string; sex: 'female' | 'male'; status: 'lookingForHome' | 'reserved' | 'adopted'; location: 'shelter' | 'germany'; place: string; isEmergency: boolean; isSponsorable: boolean; isPublished: boolean; externalProfileUrl: string; reviewRequestedAt: string | null; reviewNote: string; createdAt: string; updatedAt: string; photoCount: number; primaryAssetId: string | null }
/** `total` und `reviewPending` zählen ungefiltert — für die Zähler an den Umschaltern der Liste. */
export interface AnimalList { animals: AnimalListItem[]; total: number; reviewPending: number }

const byName = (a: { name: string; slug: string }, b: { name: string; slug: string }): number => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug);

/**
 * Die Liste für einige hundert Tiere (Spec 2026-09-30, § 5.4): zwei Abfragen
 * statt zwei je Tier. Text und Sortierung laufen in JS — SQLite faltet bei
 * `LIKE` und `ORDER BY` nur ASCII, „bär“ fände „Bärbel“ nicht.
 */
export async function listAnimals(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<AnimalList>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const parsed = validate(deps, animalListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { text, status, location, isPublished, reviewPending, orderBy } = parsed.value;
  const where = and(
    status ? eq(animals.status, status) : undefined,
    location ? eq(animals.location, location) : undefined,
    isPublished === undefined ? undefined : eq(animals.isPublished, isPublished),
    reviewPending === undefined ? undefined : reviewPending ? isNotNull(animals.reviewRequestedAt) : isNull(animals.reviewRequestedAt),
  );
  const needle = (text ?? '').toLocaleLowerCase('de');
  const rows = deps.db
    .select({ id: animals.id, slug: animals.slug, name: animals.name, sex: animals.sex, status: animals.status, location: animals.location, place: animals.place, isEmergency: animals.isEmergency, isSponsorable: animals.isSponsorable, isPublished: animals.isPublished, externalProfileUrl: animals.externalProfileUrl, reviewRequestedAt: animals.reviewRequestedAt, reviewNote: animals.reviewNote, createdAt: animals.createdAt, updatedAt: animals.updatedAt })
    .from(animals)
    .where(where)
    .all()
    .filter((a) => !needle || a.name.toLocaleLowerCase('de').includes(needle) || a.slug.includes(needle));

  const field = orderBy?.field ?? 'name';
  const sign = orderBy?.direction === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    if (field === 'name') return sign * byName(a, b);
    const x = a[field];
    const y = b[field];
    // Ohne Zeitpunkt ans Ende, in beiden Richtungen; Gleichstand fällt auf den Namen.
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return x === y ? byName(a, b) : sign * (x < y ? -1 : 1);
  });

  const photos = new Map<string, { count: number; primary: string | null; first: string | null }>();
  if (rows.length > 0) {
    // Alle Fotos der Liste in einem Zug. Ohne `inArray` bei ungefilterter Liste: SQLite begrenzt die Zahl der Bindevariablen.
    const all = deps.db.select({ animalId: animalPhotos.animalId, assetId: animalPhotos.assetId, isPrimary: animalPhotos.isPrimary }).from(animalPhotos);
    const wanted = where || needle ? all.where(inArray(animalPhotos.animalId, rows.map((a) => a.id))) : all;
    for (const p of wanted.orderBy(asc(animalPhotos.sortOrder)).all()) {
      const entry = photos.get(p.animalId) ?? { count: 0, primary: null, first: null };
      entry.count += 1;
      entry.first ??= p.assetId;
      if (p.isPrimary) entry.primary ??= p.assetId;
      photos.set(p.animalId, entry);
    }
  }
  const total = deps.db.select({ n: count() }).from(animals).get()?.n ?? 0;
  const pending = deps.db.select({ n: count() }).from(animals).where(isNotNull(animals.reviewRequestedAt)).get()?.n ?? 0;
  return ok({
    animals: rows.map((a) => { const p = photos.get(a.id); return { ...a, photoCount: p?.count ?? 0, primaryAssetId: p?.primary ?? p?.first ?? null }; }),
    total,
    reviewPending: pending,
  });
}

export async function getAnimal(deps: Deps, ctx: CallContext, id: string): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const record = loadAnimal(deps.db, id);
  return record ? ok(record) : notFound('animal', id);
}

export const animalDeleteSchema = z.object({ id: z.string().min(1), deleteOrphanedMedia: z.boolean().default(false) });

/** Alle Medien, die am Tier hängen: die Fotos und die beiden Bilder der Erfolgsgeschichte. */
const assetIdsOf = (a: AnimalRecord): string[] => [...a.photos.map((p) => p.assetId), a.story?.beforeAssetId, a.story?.afterAssetId].filter((id): id is string => !!id);

/** Die eine Stelle, die über die Löschbarkeit eines Tiers entscheidet — für den Dienst und den Dialog. */
const deletionPreviewOf = (deps: Deps, a: AnimalRecord): DeletionPreview => buildDeletionPreview(deps, { entityType: 'animal', id: a.id, isPublished: a.isPublished, assetIds: assetIdsOf(a) });

export async function animalDeletionPreview(deps: Deps, ctx: CallContext, id: string): Promise<Result<DeletionPreview>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const animal = loadAnimal(deps.db, id);
  return animal ? ok(deletionPreviewOf(deps, animal)) : notFound('animal', id);
}

/**
 * Löscht ein Tierprofil samt Foto-Zuordnung und Erfolgsgeschichte. Ein Profil
 * ist Webseiteninhalt; rechenschaftsrelevant sind die Vorgänge, die daran
 * hängen — sie melden sich als Halter oder Verweis und verhindern die Löschung.
 * Zwei Stufen: Veröffentlichtes wird erst zurückgezogen.
 */
export async function deleteAnimal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MediaCleanup>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalDeleteSchema, input);
  if (!parsed.ok) return parsed;
  if (parsed.value.deleteOrphanedMedia) {
    const mediaDenied = requirePermission(ctx, 'media.upload');
    if (mediaDenied) return mediaDenied;
  }
  const before = loadAnimal(deps.db, parsed.value.id);
  if (!before) return notFound('animal', parsed.value.id);
  const blocked = deletionConflict(deletionPreviewOf(deps, before));
  if (blocked) return blocked;

  const assetIds = assetIdsOf(before);
  deps.db.transaction((tx) => {
    tx.delete(animalPhotos).where(eq(animalPhotos.animalId, before.id)).run();
    tx.delete(animalStories).where(eq(animalStories.animalId, before.id)).run();
    tx.delete(animals).where(eq(animals.id, before.id)).run();
    notifyRecordDeleted(tx, deps, ctx, 'animal', before.id);
    recordAudit(tx, deps, ctx, { action: 'animals.delete', entityType: 'animal', entityId: before.id, before, summary: `Tier ${before.name} gelöscht` });
  });
  if (!parsed.value.deleteOrphanedMedia) return ok({ deletedMedia: [], keptMedia: [] });
  return deleteUnreferencedMedia(deps, ctx, assetIds);
}

export function findAnimalBySlug(db: DbOrTx, slug: string): AnimalRecord | null {
  const row = db.select({ id: animals.id }).from(animals).where(and(eq(animals.slug, slug))).get();
  return row ? loadAnimal(db, row.id) : null;
}
