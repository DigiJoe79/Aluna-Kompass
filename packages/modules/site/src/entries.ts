import {
  type CallContext,
  type DbOrTx,
  type DeletionPreview,
  type Deps,
  type MediaCleanup,
  type Result,
  buildDeletionPreview,
  conflict,
  deleteUnreferencedMedia,
  deletionConflict,
  expectedVersionField,
  invalid,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
  staleVersion,
  validate,
  zodIssues,
  localizedConflict,
} from '@kompass/core';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schemaFor } from './field-schema';
import { assetKeys } from './references';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { TemplateSchema } from './load';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

type CollectionDef = TemplateSchema['collections'][string];
export type SiteEntry = typeof siteEntries.$inferSelect;

const createInput = z.object({
  collection: z.string().min(1),
  slug: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
const updateInput = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  /** Ladestand der Maske (`updatedAt`); veraltet → `staleVersion`. */
  expectedVersion: expectedVersionField,
});
const deleteInput = z.object({ id: z.string().min(1), deleteOrphanedMedia: z.boolean().default(false) });
const reorderInput = z.object({ collection: z.string().min(1), ids: z.array(z.string().min(1)) });
const publishInput = z.object({ id: z.string().min(1), isPublished: z.boolean() });

const collectionOf = (deps: Deps, key: string): CollectionDef | undefined => activeTemplate(deps)?.schema.collections[key];

const dataSchema = (col: CollectionDef) =>
  z.object(Object.fromEntries(Object.entries(col.fields).map(([key, field]) => [key, schemaFor(field).optional()])));

const rowsOf = (db: DbOrTx, collection: string) =>
  db.select().from(siteEntries).where(eq(siteEntries.collection, collection)).orderBy(asc(siteEntries.sortOrder)).all();

const slugTaken = (db: DbOrTx, collection: string, slug: string, exceptId?: string) => {
  const row = db.select({ id: siteEntries.id }).from(siteEntries).where(and(eq(siteEntries.collection, collection), eq(siteEntries.slug, slug))).get();
  return !!row && row.id !== exceptId;
};

function checkSlug(col: CollectionDef, slug: string | undefined): Result<string | null> {
  if (col.slug) {
    if (!slug || !SLUG.test(slug)) return invalid([{ path: 'slug', message: 'invalidSlug' }]);
    return ok(slug);
  }
  if (slug !== undefined && slug !== '') return invalid([{ path: 'slug', message: 'slugNotAllowed' }]);
  return ok(null);
}

export async function listEntries(deps: Deps, ctx: CallContext, collection: string): Promise<Result<SiteEntry[]>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  if (!collectionOf(deps, collection)) return notFound('siteCollection', collection);
  return ok(rowsOf(deps.db, collection));
}

export async function getEntry(deps: Deps, ctx: CallContext, id: string): Promise<Result<SiteEntry>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const row = deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get();
  return row ? ok(row) : notFound('siteEntry', id);
}

export async function createEntry(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<SiteEntry>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const { collection, slug, data } = parsed.data;

  const col = collectionOf(deps, collection);
  if (!col) return notFound('siteCollection', collection);

  const slugResult = checkSlug(col, slug);
  if (!slugResult.ok) return slugResult;

  const validated = validate(deps, dataSchema(col), data);
  if (!validated.ok) return validated;

  const existing = rowsOf(deps.db, collection);
  if (col.max !== undefined && existing.length >= col.max) {
    return localizedConflict('tooManyEntries', 'errors.site.tooManyEntries', { collection: col.label, max: col.max });
  }
  if (slugResult.value && slugTaken(deps.db, collection, slugResult.value)) {
    return localizedConflict('duplicateSlug', 'errors.site.duplicateSlug', { slug: slugResult.value, collection: col.label });
  }

  const now = isoNow(deps.clock);
  const id = newId();
  const sortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder), 0) + (existing.length > 0 ? 1 : 0);
  return deps.db.transaction((tx) => {
    tx.insert(siteEntries)
      .values({ id, collection, slug: slugResult.value, sortOrder, isPublished: false, data: validated.value, createdAt: now, updatedAt: now })
      .run();
    const row = tx.select().from(siteEntries).where(eq(siteEntries.id, id)).get()!;
    recordAudit(tx, deps, ctx, { action: 'site.entry.create', entityType: 'siteEntry', entityId: id, after: row, params: { collection: col.label } });
    return ok(row);
  });
}

export async function updateEntry(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<SiteEntry>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const { id, slug, data, expectedVersion } = parsed.data;

  const before = deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get();
  if (!before) return notFound('siteEntry', id);
  const stale = staleVersion(expectedVersion, before.updatedAt);
  if (stale) return stale;
  const col = collectionOf(deps, before.collection);
  if (!col) return notFound('siteCollection', before.collection);

  let nextSlug = before.slug;
  if (slug !== undefined) {
    const slugResult = checkSlug(col, slug);
    if (!slugResult.ok) return slugResult;
    if (slugResult.value && slugTaken(deps.db, before.collection, slugResult.value, id)) {
      return localizedConflict('duplicateSlug', 'errors.site.duplicateSlug', { slug: slugResult.value, collection: col.label });
    }
    nextSlug = slugResult.value;
  }

  let nextData = before.data as Record<string, unknown>;
  if (data !== undefined) {
    const validated = validate(deps, dataSchema(col), { ...(before.data as Record<string, unknown>), ...data });
    if (!validated.ok) return validated;
    nextData = validated.value;
  }

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx) => {
    tx.update(siteEntries).set({ slug: nextSlug, data: nextData, updatedAt: now }).where(eq(siteEntries.id, id)).run();
    const after = tx.select().from(siteEntries).where(eq(siteEntries.id, id)).get()!;
    recordAudit(tx, deps, ctx, { action: 'site.entry.update', entityType: 'siteEntry', entityId: id, before, after, params: { collection: col.label } });
    return ok(after);
  });
}

/** Die Medien eines Eintrags: die Werte seiner als Asset deklarierten Felder. */
function assetIdsOf(col: CollectionDef | undefined, entry: SiteEntry): string[] {
  if (!col) return [];
  const data = entry.data as Record<string, unknown>;
  return assetKeys(col.fields)
    .map((key) => data[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Die eine Stelle, die über die Löschbarkeit eines Eintrags entscheidet — für
 * den Dienst und den Dialog. `isPublished` zählt nur, wo die Sammlung den
 * Schalter kennt; sonst wäre ein Eintrag nie zurückziehbar und nie löschbar.
 */
const deletionPreviewOf = (deps: Deps, col: CollectionDef | undefined, entry: SiteEntry): DeletionPreview =>
  buildDeletionPreview(deps, { entityType: 'siteEntry', id: entry.id, isPublished: !!col?.publishable && entry.isPublished, assetIds: assetIdsOf(col, entry) });

export async function entryDeletionPreview(deps: Deps, ctx: CallContext, id: string): Promise<Result<DeletionPreview>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const entry = deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get();
  if (!entry) return notFound('siteEntry', id);
  return ok(deletionPreviewOf(deps, collectionOf(deps, entry.collection), entry));
}

export async function deleteEntry(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<MediaCleanup>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  if (parsed.data.deleteOrphanedMedia) {
    const mediaDenied = requirePermission(ctx, 'media.upload');
    if (mediaDenied) return mediaDenied;
  }

  const before = deps.db.select().from(siteEntries).where(eq(siteEntries.id, parsed.data.id)).get();
  if (!before) return notFound('siteEntry', parsed.data.id);
  const col = collectionOf(deps, before.collection);
  const blocked = deletionConflict(deps, deletionPreviewOf(deps, col, before));
  if (blocked) return blocked;

  const assetIds = assetIdsOf(col, before);
  deps.db.transaction((tx) => {
    tx.delete(siteEntries).where(eq(siteEntries.id, before.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'site.entry.delete',
      entityType: 'siteEntry',
      entityId: before.id,
      before,
      params: { collection: col?.label ?? before.collection },
    });
  });
  if (!parsed.data.deleteOrphanedMedia) return ok({ deletedMedia: [], keptMedia: [] });
  return deleteUnreferencedMedia(deps, ctx, assetIds);
}

export async function reorderEntries(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<SiteEntry[]>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = reorderInput.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const { collection, ids } = parsed.data;

  const col = collectionOf(deps, collection);
  if (!col) return notFound('siteCollection', collection);

  const rows = rowsOf(deps.db, collection);
  const known = new Set(rows.map((r) => r.id));
  const unknownId = ids.find((id) => !known.has(id));
  if (unknownId) return notFound('siteEntry', unknownId);

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx) => {
    ids.forEach((id, index) => {
      tx.update(siteEntries).set({ sortOrder: index, updatedAt: now }).where(eq(siteEntries.id, id)).run();
    });
    recordAudit(tx, deps, ctx, { action: 'site.entry.reorder', entityType: 'siteCollection', entityId: collection, after: ids, params: { collection: col.label } });
    return ok(rowsOf(tx, collection));
  });
}

export async function setEntryPublished(deps: Deps, ctx: CallContext, raw: unknown): Promise<Result<SiteEntry>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = publishInput.safeParse(raw);
  if (!parsed.success) return invalid(zodIssues(parsed.error));
  const { id, isPublished } = parsed.data;

  const before = deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get();
  if (!before) return notFound('siteEntry', id);
  const col = collectionOf(deps, before.collection);
  if (!col) return notFound('siteCollection', before.collection);
  if (!col.publishable) return localizedConflict('notPublishable', 'errors.site.notPublishable', { collection: col.label });

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx) => {
    tx.update(siteEntries).set({ isPublished, updatedAt: now }).where(eq(siteEntries.id, id)).run();
    const after = tx.select().from(siteEntries).where(eq(siteEntries.id, id)).get()!;
    // Die Aktion steht als fester Text im Aufruf (Wächter audit-actions), deshalb zwei Aufrufe.
    const entry = { entityType: 'siteEntry', entityId: id, before: { isPublished: before.isPublished }, after: { isPublished }, params: { collection: col.label } };
    if (isPublished) recordAudit(tx, deps, ctx, { action: 'site.entry.publish', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'site.entry.unpublish', ...entry });
    return ok(after);
  });
}
