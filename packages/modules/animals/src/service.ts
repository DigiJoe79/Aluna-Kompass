import { conflict, emptyLocalized, invalid, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, schema as core, validate, type CallContext, type DbOrTx, type Deps, type LocalizedText, type Result } from '@kompass/core';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { animalPhotos, animalStories, animals, type LocalizedList } from './schema';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const localizedList = z.object({ de: z.array(z.string().trim().min(1).max(40)).max(12), en: z.array(z.string().trim().min(1).max(40)).max(12) });

export interface AnimalPhoto { assetId: string; sortOrder: number; isPrimary: boolean }
export interface AnimalStory { beforeAssetId: string | null; afterAssetId: string | null; quote: LocalizedText; family: string; adoptedYear: number }
export type AnimalRecord = typeof animals.$inferSelect & { photos: AnimalPhoto[]; story: AnimalStory | null };

const fields = {
  slug: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(80),
  sex: z.enum(['female', 'male']),
  birthText: localizedText({ max: 60 }),
  sizeCm: z.number().int().min(0).max(120).default(0),
  sizeText: localizedText({ max: 80 }),
  location: z.enum(['shelter', 'germany']).default('shelter'),
  isEmergency: z.boolean().default(false),
  isSponsorable: z.boolean().default(false),
  traits: localizedList.default({ de: [], en: [] }),
  externalProfileUrl: z.union([z.literal(''), z.url()]).default(''),
  summary: localizedText({ max: 300 }),
  body: localizedText({ max: 20_000 }),
};
export const animalCreateSchema = z.object(fields);
export const animalUpdateSchema = z.object({
  id: z.string().min(1),
  slug: fields.slug.optional(),
  name: fields.name.optional(),
  sex: fields.sex.optional(),
  birthText: fields.birthText.optional(),
  sizeCm: fields.sizeCm.optional(),
  sizeText: fields.sizeText.optional(),
  location: fields.location.optional(),
  isEmergency: fields.isEmergency.optional(),
  isSponsorable: fields.isSponsorable.optional(),
  traits: localizedList.optional(),
  externalProfileUrl: fields.externalProfileUrl.optional(),
  summary: fields.summary.optional(),
  body: fields.body.optional(),
});

export function loadAnimal(db: DbOrTx, id: string): AnimalRecord | null {
  const row = db.select().from(animals).where(eq(animals.id, id)).get();
  if (!row) return null;
  const photos = db.select({ assetId: animalPhotos.assetId, sortOrder: animalPhotos.sortOrder, isPrimary: animalPhotos.isPrimary }).from(animalPhotos).where(eq(animalPhotos.animalId, id)).orderBy(asc(animalPhotos.sortOrder)).all();
  const story = db.select().from(animalStories).where(eq(animalStories.animalId, id)).get();
  return { ...row, traits: row.traits as LocalizedList, photos, story: story ? { beforeAssetId: story.beforeAssetId, afterAssetId: story.afterAssetId, quote: story.quote, family: story.family, adoptedYear: story.adoptedYear } : null };
}

const slugTaken = (db: DbOrTx, slug: string, exceptId?: string) => { const r = db.select({ id: animals.id }).from(animals).where(eq(animals.slug, slug)).get(); return !!r && r.id !== exceptId; };
const imageMime = (db: DbOrTx, id: string): 'missing' | 'notImage' | 'ok' => { const m = db.select({ mime: core.mediaAssets.mimeType }).from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get()?.mime; return !m ? 'missing' : m.startsWith('image/') ? 'ok' : 'notImage'; };

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
  const { id, ...changes } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
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
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setPhotos', entityType: 'animal', entityId: id, before: before.photos, after: after.photos, summary: `Fotos von ${after.name} geändert` });
    return ok(after);
  });
}

export const animalStorySchema = z.object({ id: z.string().min(1), beforeAssetId: z.string().nullable(), afterAssetId: z.string().nullable(), quote: localizedText({ max: 600 }), family: z.string().trim().max(120), adoptedYear: z.number().int().min(2000).max(2100) });

export async function setAnimalStory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, animalStorySchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...story } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (before.status !== 'adopted') return conflict('animalNotAdopted', 'Eine Erfolgsgeschichte gibt es nur für vermittelte Tiere');
  for (const assetId of [story.beforeAssetId, story.afterAssetId]) {
    if (!assetId) continue;
    const state = imageMime(deps.db, assetId);
    if (state === 'missing') return notFound('mediaAsset', assetId);
    if (state === 'notImage') return invalid([{ path: 'beforeAssetId', message: 'notAnImage' }]);
  }
  return deps.db.transaction((tx) => {
    tx.insert(animalStories).values({ animalId: id, ...story }).onConflictDoUpdate({ target: animalStories.animalId, set: story }).run();
    tx.update(animals).set({ updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
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

export async function listAnimals(deps: Deps, ctx: CallContext): Promise<Result<AnimalRecord[]>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  return ok(deps.db.select({ id: animals.id }).from(animals).orderBy(asc(animals.name)).all().map((r) => loadAnimal(deps.db, r.id)!));
}

export async function getAnimal(deps: Deps, ctx: CallContext, id: string): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const record = loadAnimal(deps.db, id);
  return record ? ok(record) : notFound('animal', id);
}

export function findAnimalBySlug(db: DbOrTx, slug: string): AnimalRecord | null {
  const row = db.select({ id: animals.id }).from(animals).where(and(eq(animals.slug, slug))).get();
  return row ? loadAnimal(db, row.id) : null;
}
