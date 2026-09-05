import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isModuleEnabled, ok, readSetting, requirePermission, schema as core, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { findBlockedTerms, type BlockedTermHit } from './blocked-terms';
import { collectTranslationGaps, type TranslationGap } from './translation-gaps';

export interface ExportedAsset { id: string; filename: string; mimeType: string; width: number | null; height: number | null }
export interface SiteExport { contentHash: string; contentPath: string; assets: ExportedAsset[]; gaps: TranslationGap[]; violations: BlockedTermHit[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}

function collectAssetIds(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectAssetIds(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/assetId$/i.test(k) && typeof v === 'string' && v) out.add(v);
      else collectAssetIds(v, out);
    }
  }
}

const inputSchema = z.object({ jobDir: z.string().min(1) });

export async function exportSiteContent(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SiteExport>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { type: 'validation', issues: [{ path: 'jobDir', message: 'required' }] } };
  const { jobDir } = parsed.data;

  const content: Record<string, unknown> = {};
  const manifests = new Map<string, (typeof deps.registry.manifests)[number]>();
  for (const m of deps.registry.manifests) {
    if (m.key === 'website' || isModuleEnabled(deps, m.key)) {
      manifests.set(m.key, m);
    }
  }
  for (const manifest of manifests.values()) {
    for (const view of manifest.publishedViews ?? []) content[view.name] = view.load(deps);
  }
  const ids = new Set<string>();
  collectAssetIds(content, ids);
  const assets: ExportedAsset[] = [];
  await mkdir(path.join(jobDir, 'assets'), { recursive: true });
  for (const id of [...ids].sort()) {
    const row = deps.db.select().from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get();
    if (!row) continue;
    assets.push({ id: row.id, filename: row.filename, mimeType: row.mimeType, width: row.width, height: row.height });
    await writeFile(path.join(jobDir, 'assets', row.filename), await deps.media.read(row.filename));
  }
  content.assets = assets;

  const json = JSON.stringify(canonical(content), null, 2);
  const contentPath = path.join(jobDir, 'content.json');
  await writeFile(contentPath, json);
  const contentHash = createHash('sha256').update(json).digest('hex');
  const terms = readSetting<string[]>(deps, 'website.blockedTerms');
  const violations = findBlockedTerms(content, terms, assets.map((a) => a.filename));
  const gaps = collectTranslationGaps(content as Record<string, unknown[]>);
  return ok({ contentHash, contentPath, assets, gaps, violations });
}
