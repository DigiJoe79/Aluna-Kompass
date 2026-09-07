import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type CallContext,
  type Deps,
  type Result,
  conflict,
  isModuleEnabled,
  ok,
  requirePermission,
  schema as core,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import type { FieldSchema } from './types';
import { z } from 'zod';
import { siteTemplateDir } from './env';
import { siteEntries } from './schema';
import { activeTemplate, templateIsCurrent } from './service';
import { readValues } from './values';

const LOCALE_KEY = /^[a-z]{2}(-[a-z]{2})?$/;

const inputSchema = z.object({ jobDir: z.string().min(1), templateDir: z.string().optional() });

export interface ExportedAsset {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface SiteContentExport {
  contentHash: string;
  contentPath: string;
  assets: ExportedAsset[];
}

const isLocalizedMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => LOCALE_KEY.test(k));

/** Wirft jede Sprache weg, die diese Installation nicht führt — auch Restmüll einer entfernten. */
function pruneLocales(value: unknown, locales: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => pruneLocales(v, locales));
  if (isLocalizedMap(value)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => locales.includes(k)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pruneLocales(v, locales)]));
  }
  return value;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
};

/**
 * Assets aus Template-Inhalt: erkannt am Schema, nicht am Feldnamen. Ein
 * Template-Autor benennt seine Felder selbst — `heroImage`, `titelbild`, was
 * auch immer —, markiert sie aber über den Feldhelfer als `asset`.
 */
function assetIdsFromFields(fields: Record<string, FieldSchema>, value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const [key, field] of Object.entries(fields)) {
    if (field.widget !== 'asset') continue;
    const id = record[key];
    if (typeof id === 'string' && id) out.add(id);
  }
}

/**
 * Assets aus den Sichten der Fachmodule: dort greift weiterhin die
 * Namenskonvention, weil diese Sichten im Quelltext definiert sind und sich
 * daran halten — `photos: [{ assetId }]`, `beforeAssetId`, `afterAssetId`.
 */
function assetIdsFromViews(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => assetIdsFromViews(n, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (/assetid$/i.test(key) && typeof value === 'string' && value) out.add(value);
      else assetIdsFromViews(value, out);
    }
  }
}

/**
 * Schreibt `content.json` in der Form der Spec: Variablen, Sammlungen, Sichten,
 * Assets. Vorher prüft die Publish-Sicherung, dass die Datei im Volume dem
 * eingelesenen Stand entspricht.
 */
export async function exportSiteContent(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SiteContentExport>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { type: 'validation', issues: [{ path: 'jobDir', message: 'required' }] } };
  const { jobDir } = parsed.data;
  const templateDir = parsed.data.templateDir ?? siteTemplateDir();

  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  if (!(await templateIsCurrent(deps, templateDir))) {
    return conflict('templateStale', 'Die Template-Datei weicht vom eingelesenen Stand ab; erst neu einlesen');
  }

  const locales = deps.locales();

  const variables = pruneLocales(readValues(deps), locales) as Record<string, unknown>;

  const collections: Record<string, unknown[]> = {};
  for (const [key, col] of Object.entries(template.schema.collections)) {
    const rows = deps.db
      .select()
      .from(siteEntries)
      .where(eq(siteEntries.collection, key))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((row) => !col.publishable || row.isPublished);
    collections[key] = rows.map((row) => ({
      ...(pruneLocales(row.data, locales) as Record<string, unknown>),
      ...(col.slug ? { slug: row.slug } : {}),
      ...(col.sortable ? { sortOrder: row.sortOrder } : {}),
    }));
  }

  const views: Record<string, unknown[]> = {};
  for (const use of template.schema.uses) {
    const manifest = deps.registry.manifests.find((m) => m.key === use);
    if (!manifest || !isModuleEnabled(deps, use)) {
      return conflict('moduleDisabled', `Das Template nutzt Sichten von „${use}", aber das Modul ist nicht aktiv`);
    }
    for (const view of manifest.publishedViews ?? []) {
      views[view.name] = pruneLocales(view.load(deps), locales) as unknown[];
    }
  }

  const ids = new Set<string>();
  assetIdsFromFields(template.schema.variables, variables, ids);
  for (const [key, col] of Object.entries(template.schema.collections)) {
    for (const entry of collections[key] ?? []) assetIdsFromFields(col.fields, entry, ids);
  }
  assetIdsFromViews(views, ids);
  const assets: ExportedAsset[] = [];
  await mkdir(path.join(jobDir, 'assets'), { recursive: true });
  for (const id of [...ids].sort()) {
    const row = deps.db.select().from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get();
    if (!row) continue;
    assets.push({ id: row.id, filename: row.filename, mimeType: row.mimeType, width: row.width, height: row.height });
    await writeFile(path.join(jobDir, 'assets', row.filename), await deps.media.read(row.filename));
  }

  const json = JSON.stringify(canonical({ variables, collections, views, assets }), null, 2);
  const contentPath = path.join(jobDir, 'content.json');
  await writeFile(contentPath, json);
  const contentHash = createHash('sha256').update(json).digest('hex');
  return ok({ contentHash, contentPath, assets });
}
