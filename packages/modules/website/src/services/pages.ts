import { isoNow, localizedText, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { WEBSITE_PAGE_KEYS } from '../page-keys';
import { websitePages, type PageBlock } from '../schema';
import { assetMime } from './common';

export type PageRecord = typeof websitePages.$inferSelect;

export const pageBlockSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  title: localizedText({ max: 120 }),
  text: localizedText({ max: 1000 }),
  imageAssetId: z.string().nullable().default(null),
  href: z.string().max(300).default(''),
  label: localizedText({ max: 60 }),
});

export function ensurePages(deps: Deps): void {
  const existing = new Set(deps.db.select({ key: websitePages.key }).from(websitePages).all().map((r) => r.key));
  const empty = { de: '', en: '' };
  const now = isoNow(deps.clock);
  for (const key of WEBSITE_PAGE_KEYS) {
    if (!existing.has(key)) deps.db.insert(websitePages).values({ key, title: empty, lede: empty, body: empty, metaDescription: empty, blocks: [], updatedAt: now }).run();
  }
}

export async function listPages(deps: Deps, ctx: CallContext): Promise<Result<PageRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensurePages(deps);
  const rows = deps.db.select().from(websitePages).all();
  const order = new Map(WEBSITE_PAGE_KEYS.map((k, i) => [k, i]));
  return ok(rows.sort((a, b) => (order.get(a.key as never) ?? 99) - (order.get(b.key as never) ?? 99)));
}

export async function getPage(deps: Deps, ctx: CallContext, key: string): Promise<Result<PageRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensurePages(deps);
  const row = deps.db.select().from(websitePages).where(eq(websitePages.key, key)).get();
  return row ? ok(row) : notFound('websitePage', key);
}

export const pageUpdateSchema = z.object({
  key: z.enum(WEBSITE_PAGE_KEYS),
  title: localizedText({ max: 160 }).optional(),
  lede: localizedText({ max: 600 }).optional(),
  body: localizedText({ max: 40_000 }).optional(),
  metaDescription: localizedText({ max: 200 }).optional(),
  blocks: z.array(pageBlockSchema).max(12).optional(),
});

export async function updatePage(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PageRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(deps, pageUpdateSchema, input);
  if (!parsed.ok) {
    // unbekannter key ⇒ notFound statt validation, damit die UI 404 zeigen kann
    const key = (input as { key?: unknown })?.key;
    if (typeof key === 'string' && !(WEBSITE_PAGE_KEYS as readonly string[]).includes(key as never)) return notFound('websitePage', key);
    return parsed;
  }
  ensurePages(deps);
  const { key, ...changes } = parsed.value;
  for (const block of changes.blocks ?? []) {
    if (block.imageAssetId && assetMime(deps.db, block.imageAssetId) === null) return notFound('mediaAsset', block.imageAssetId);
  }
  const before = deps.db.select().from(websitePages).where(eq(websitePages.key, key)).get()!;
  return deps.db.transaction((tx) => {
    tx.update(websitePages).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websitePages.key, key)).run();
    const after = tx.select().from(websitePages).where(eq(websitePages.key, key)).get()!;
    recordAudit(tx, deps, ctx, { action: 'website.pages.update', entityType: 'websitePage', entityId: key, before, after, summary: `Seite ${key} geändert` });
    return ok(after);
  });
}

export type { PageBlock };
