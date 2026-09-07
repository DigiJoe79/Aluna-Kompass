import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets, projects } from '../db/schema';
import type { Deps } from '../deps';
import { localizedText } from '../i18n/localized';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { validate } from '../validate';

export type ProjectRecord = typeof projects.$inferSelect;

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

const projectFields = {
  slug: z.string().regex(SLUG),
  name: localizedText({ required: true, max: 120 }),
  type: z.enum(['ongoing', 'shortTerm']),
  status: z.enum(['active', 'completed']).default('active'),
  summary: localizedText({ max: 400 }),
  body: localizedText({ max: 20_000 }),
  imageAssetId: z.string().nullable().default(null),
  betterplaceProjectId: z.string().trim().max(40).default(''),
};
export const projectCreateSchema = z.object(projectFields);
export const projectUpdateSchema = z.object({
  id: z.string().min(1),
  slug: projectFields.slug.optional(),
  name: projectFields.name.optional(),
  type: projectFields.type.optional(),
  status: projectFields.status.optional(),
  summary: projectFields.summary.optional(),
  body: projectFields.body.optional(),
  imageAssetId: projectFields.imageAssetId.optional(),
  betterplaceProjectId: projectFields.betterplaceProjectId.optional(),
});

function load(db: DbOrTx, id: string): ProjectRecord | null {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

function slugTaken(db: DbOrTx, slug: string, exceptId?: string): boolean {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  return !!row && row.id !== exceptId;
}

function assetExists(db: DbOrTx, id: string | null): boolean {
  return id === null || !!db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, id)).get();
}

export async function createProject(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(projectCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (slugTaken(deps.db, v.slug)) return conflict('slugTaken', `Slug ${v.slug} ist bereits vergeben`);
  if (!assetExists(deps.db, v.imageAssetId)) return notFound('mediaAsset', v.imageAssetId ?? '');
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    const max = tx.select({ n: sql<number>`coalesce(max(${projects.sortOrder}), 0)` }).from(projects).get()?.n ?? 0;
    tx.insert(projects).values({ id, ...v, sortOrder: max + 1, isPublished: false, createdAt: now, updatedAt: now }).run();
    const record = load(tx, id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: 'projects.create', entityType: 'project', entityId: id, after: record, summary: `Projekt ${v.slug} angelegt` });
    return ok(record);
  });
}

export async function updateProject(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(projectUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('project', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  if (changes.imageAssetId !== undefined && !assetExists(deps.db, changes.imageAssetId)) return notFound('mediaAsset', changes.imageAssetId ?? '');
  return deps.db.transaction((tx) => {
    tx.update(projects).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(projects.id, id)).run();
    const after = load(tx, id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: 'projects.update', entityType: 'project', entityId: id, before, after, summary: `Projekt ${after.slug} geändert` });
    return ok(after);
  });
}

const publishSchema = z.object({ id: z.string().min(1), isPublished: z.boolean() });

export async function setProjectPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(publishSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('project', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(projects).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(projects.id, before.id)).run();
    const after = load(tx, before.id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: parsed.value.isPublished ? 'projects.publish' : 'projects.unpublish', entityType: 'project', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `Projekt ${after.slug} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export async function reorderProjects(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(reorderSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(projects).set({ sortOrder: index + 1 }).where(eq(projects.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'projects.reorder', entityType: 'project', entityId: null, after: parsed.value.ids, summary: 'Projektreihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listProjects(deps: Deps, ctx: CallContext): Promise<Result<ProjectRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(projects).orderBy(asc(projects.sortOrder)).all());
}

export async function getProject(deps: Deps, ctx: CallContext, id: string): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('project', id);
}
