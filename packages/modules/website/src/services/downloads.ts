import { invalid, isoNow, localizedText, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { WEBSITE_DOWNLOAD_KEYS } from '../page-keys';
import { websiteDownloads } from '../schema';
import { assetMime } from './common';

export type DownloadRecord = typeof websiteDownloads.$inferSelect;

function ensureDownloads(deps: Deps): void {
  const existing = new Set(deps.db.select({ key: websiteDownloads.key }).from(websiteDownloads).all().map((r) => r.key));
  for (const key of WEBSITE_DOWNLOAD_KEYS) {
    if (!existing.has(key)) deps.db.insert(websiteDownloads).values({ key, title: { de: '', en: '' }, assetId: null, updatedAt: isoNow(deps.clock) }).run();
  }
}

export async function listDownloads(deps: Deps, ctx: CallContext): Promise<Result<DownloadRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensureDownloads(deps);
  const rows = deps.db.select().from(websiteDownloads).all();
  const order = new Map(WEBSITE_DOWNLOAD_KEYS.map((k, i) => [k, i]));
  return ok(rows.sort((a, b) => (order.get(a.key as never) ?? 99) - (order.get(b.key as never) ?? 99)));
}

const setSchema = z.object({ key: z.enum(WEBSITE_DOWNLOAD_KEYS), title: localizedText({ required: true, max: 120 }), assetId: z.string().min(1).nullable() });

export async function setDownload(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DownloadRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(setSchema, input);
  if (!parsed.ok) return parsed;
  ensureDownloads(deps);
  const { key, title, assetId } = parsed.value;
  if (assetId) {
    const mime = assetMime(deps.db, assetId);
    if (mime === null) return notFound('mediaAsset', assetId);
    if (mime !== 'application/pdf') return invalid([{ path: 'assetId', message: 'downloadNotPdf' }]);
  }
  const before = deps.db.select().from(websiteDownloads).where(eq(websiteDownloads.key, key)).get()!;
  return deps.db.transaction((tx) => {
    tx.update(websiteDownloads).set({ title, assetId, updatedAt: isoNow(deps.clock) }).where(eq(websiteDownloads.key, key)).run();
    const after = tx.select().from(websiteDownloads).where(eq(websiteDownloads.key, key)).get()!;
    recordAudit(tx, deps, ctx, { action: 'website.downloads.set', entityType: 'websiteDownload', entityId: key, before, after, summary: `Download ${key} gesetzt` });
    return ok(after);
  });
}
