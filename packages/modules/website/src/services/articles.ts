import { conflict, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { websiteArticles } from '../schema';
import { nextSortOrder, SLUG } from './common';

export type ArticleRecord = typeof websiteArticles.$inferSelect;

const fields = {
  slug: z.string().regex(SLUG),
  title: localizedText({ required: true, max: 160 }),
  lede: localizedText({ max: 600 }),
  body: localizedText({ max: 40_000 }),
  publishedAt: z.union([z.null(), z.iso.date()]).default(null),
};
export const articleCreateSchema = z.object(fields);
export const articleUpdateSchema = z.object({
  id: z.string().min(1),
  slug: fields.slug.optional(),
  title: fields.title.optional(),
  lede: fields.lede.optional(),
  body: fields.body.optional(),
  publishedAt: fields.publishedAt.optional(),
});

const load = (db: Deps['db'], id: string) => db.select().from(websiteArticles).where(eq(websiteArticles.id, id)).get() ?? null;
const slugTaken = (db: Deps['db'], slug: string, exceptId?: string) => {
  const r = db.select({ id: websiteArticles.id }).from(websiteArticles).where(eq(websiteArticles.slug, slug)).get();
  return !!r && r.id !== exceptId;
};

export async function createArticle(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(articleCreateSchema, input);
  if (!parsed.ok) return parsed;
  if (slugTaken(deps.db, parsed.value.slug)) return conflict('slugTaken', `Slug ${parsed.value.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(websiteArticles).values({ id, ...parsed.value, sortOrder: nextSortOrder(tx, websiteArticles, websiteArticles.sortOrder), isPublished: false, createdAt: now, updatedAt: now }).run();
    const record = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.articles.create', entityType: 'websiteArticle', entityId: id, after: record, summary: `Artikel ${record.slug} angelegt` });
    return ok(record);
  });
}

export async function updateArticle(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(articleUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('websiteArticle', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(websiteArticles).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websiteArticles.id, id)).run();
    const after = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.articles.update', entityType: 'websiteArticle', entityId: id, before, after, summary: `Artikel ${after.slug} geändert` });
    return ok(after);
  });
}

export async function setArticlePublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('websiteArticle', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(websiteArticles).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(websiteArticles.id, before.id)).run();
    const after = load(tx as Deps['db'], before.id)!;
    recordAudit(tx, deps, ctx, { action: parsed.value.isPublished ? 'website.articles.publish' : 'website.articles.unpublish', entityType: 'websiteArticle', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `Artikel ${after.slug} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

export async function reorderArticles(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ ids: z.array(z.string().min(1)).min(1) }), input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(websiteArticles).set({ sortOrder: index + 1 }).where(eq(websiteArticles.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'website.articles.reorder', entityType: 'websiteArticle', entityId: null, after: parsed.value.ids, summary: 'Artikelreihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listArticles(deps: Deps, ctx: CallContext): Promise<Result<ArticleRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websiteArticles).orderBy(asc(websiteArticles.sortOrder)).all());
}

export async function getArticle(deps: Deps, ctx: CallContext, id: string): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('websiteArticle', id);
}
