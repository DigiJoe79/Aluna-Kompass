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
  readSetting,
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

export interface ExportChecks {
  gaps: { path: string; locale: string }[];
  violations: { path: string; term: string; excerpt: string }[];
}

export interface SiteContentExport extends ExportChecks {
  contentHash: string;
  contentPath: string;
  assets: ExportedAsset[];
}

const isLocalizedMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => LOCALE_KEY.test(k));

/** Jeder Text im Export, mit seinem Pfad — Variablen wie Sammlungseinträge. */
export function* texts(node: unknown, path = ''): Generator<{ path: string; locale: string; value: string }> {
  if (typeof node === 'string') {
    yield { path, locale: '', value: node };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      yield* texts(node[i], childPath);
    }
    return;
  }
  if (node && typeof node === 'object') {
    if (isLocalizedMap(node)) {
      for (const [locale, val] of Object.entries(node)) {
        if (typeof val === 'string') {
          yield { path, locale, value: val };
        } else if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            yield { path: `${path}[${i}]`, locale, value: String(val[i]) };
          }
        } else {
          yield* texts(val, path ? `${path}.${locale}` : locale);
        }
      }
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      yield* texts(val, childPath);
    }
  }
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectViolations(
  content: unknown,
  terms: string[],
  assets: ExportedAsset[],
): { path: string; term: string; excerpt: string }[] {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (needles.length === 0) return [];
  const patterns = needles.map((term) => {
    const parts = term.split(/[\s_\-]+/).filter(Boolean).map(escapeRegex);
    const regex = new RegExp(parts.join('[\\s_\\-]+'), 'i');
    return { term, regex };
  });

  const hits: { path: string; term: string; excerpt: string }[] = [];
  for (const item of texts(content)) {
    for (const { term, regex } of patterns) {
      const match = item.value.match(regex);
      if (match && match.index !== undefined) {
        hits.push({
          path: item.locale ? `${item.path}.${item.locale}` : item.path,
          term,
          excerpt: excerptAround(item.value, match.index, match[0].length),
        });
      }
    }
  }
  for (const asset of assets) {
    for (const { term, regex } of patterns) {
      const match = asset.filename.match(regex);
      if (match && match.index !== undefined) {
        hits.push({
          path: `files/${asset.filename}`,
          term,
          excerpt: asset.filename,
        });
      }
    }
  }
  return hits;
}

function collectGaps(node: unknown, path: string, locales: readonly string[], gaps: { path: string; locale: string }[]): void {
  if (!node || typeof node !== 'object') return;
  if (isLocalizedMap(node)) {
    const [leading, ...rest] = locales;
    if (leading && rest.length > 0) {
      const record = node as Record<string, unknown>;
      const leadingVal = record[leading];
      const leadingFilled = typeof leadingVal === 'string' ? leadingVal.trim().length > 0 : Array.isArray(leadingVal) ? leadingVal.length > 0 : false;
      if (leadingFilled) {
        for (const loc of rest) {
          const val = record[loc];
          const empty = typeof val === 'string' ? val.trim().length === 0 : Array.isArray(val) ? val.length === 0 : true;
          if (empty) {
            gaps.push({ path, locale: loc });
          }
        }
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      collectGaps(node[i], path ? `${path}[${i}]` : `[${i}]`, locales, gaps);
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    collectGaps(v, path ? `${path}.${k}` : k, locales, gaps);
  }
}

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
  // Die Sichten des Kerns sind immer dabei: Vereinsstammdaten pflegt man einmal
  // in den Einstellungen, kein Template soll sie als Variablen verdoppeln.
  for (const view of deps.registry.module('core')?.publishedViews ?? []) {
    views[view.name] = pruneLocales(view.load(deps), locales) as unknown[];
  }
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

  const contentPayload = { variables, collections, views };
  const json = JSON.stringify(canonical({ variables, collections, views, assets }), null, 2);
  const contentPath = path.join(jobDir, 'content.json');
  await writeFile(contentPath, json);
  const contentHash = createHash('sha256').update(json).digest('hex');

  const terms = deps.registry.settingDefinitions.has('site.blockedTerms')
    ? readSetting<string[]>(deps, 'site.blockedTerms')
    : [];
  const violations = collectViolations(contentPayload, terms, assets);
  const gaps: { path: string; locale: string }[] = [];
  collectGaps(contentPayload, '', locales, gaps);

  return ok({ contentHash, contentPath, assets, gaps, violations });
}
