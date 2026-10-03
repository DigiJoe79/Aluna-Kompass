import { siteTestBrake } from './test-brake';
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
  localizedConflict,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import type { FieldSchema } from './types';
import { z } from 'zod';
import { previousTemplateDir, siteTemplateDir } from './env';
import { entryLabel } from './entry-label';
import { checkReferenceValues } from './reference-fields';
import { siteEntries } from './schema';
import { activeTemplate, templateIsCurrent } from './service';
import { settleTemplateAfterImport, templateNeedsReview } from './review';
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

/** Wo ein Treffer zu bearbeiten ist: Variablen haben eine Seite, Sammlungseinträge je eine Maske, Zeilen einer Sicht ihre Adresse (`editLink` der Sicht). Dateinamen tragen keinen Verweis. */
export type SiteViolationEdit = { kind: 'variables' } | { kind: 'entry'; collection: string; id: string; title: string } | { kind: 'view'; href: string; title: string };
export interface SiteViolation {
  path: string;
  term: string;
  excerpt: string;
  edit?: SiteViolationEdit;
}

export interface ExportChecks {
  gaps: { path: string; locale: string }[];
  violations: SiteViolation[];
  /** Referenzwerte, die nicht mehr in der gefilterten Sicht stehen; im Export durch null ersetzt bzw. aus der Liste genommen. */
  stale: { path: string; value: string }[];
  /** Veröffentlichte Datensätze, die auf eine Prüfung durch einen Menschen warten. Eine Warnung, keine Sperre. */
  pendingReview: { view: string; label: string; href: string }[];
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

/** Fragt die Sicht erst beim Treffer nach dem Weg zur Zeile; `rows` sind die Zeilen des Exports in seiner Reihenfolge. */
type ViewLinks = Record<string, (index: number) => { href: string; title: string } | null>;

function editFor(path: string, refs: Record<string, { id: string; title: string }[]>, viewLinks: ViewLinks): SiteViolationEdit | undefined {
  if (path.startsWith('variables.')) return { kind: 'variables' };
  const v = /^views\.([^.[]+)\[(\d+)\]/.exec(path);
  if (v) {
    const link = viewLinks[v[1]!]?.(Number(v[2]));
    return link ? { kind: 'view', href: link.href, title: link.title } : undefined;
  }
  const m = /^collections\.([^.[]+)\[(\d+)\]/.exec(path);
  const ref = m ? refs[m[1]!]?.[Number(m[2])] : undefined;
  return m && ref ? { kind: 'entry', collection: m[1]!, id: ref.id, title: ref.title } : undefined;
}

function collectViolations(
  content: unknown,
  terms: string[],
  assets: ExportedAsset[],
  refs: Record<string, { id: string; title: string }[]>,
  viewLinks: ViewLinks,
): SiteViolation[] {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (needles.length === 0) return [];
  const patterns = needles.map((term) => {
    const parts = term.split(/[\s_\-]+/).filter(Boolean).map(escapeRegex);
    const regex = new RegExp(parts.join('[\\s_\\-]+'), 'i');
    return { term, regex };
  });

  const hits: SiteViolation[] = [];
  for (const item of texts(content)) {
    for (const { term, regex } of patterns) {
      const match = item.value.match(regex);
      if (match && match.index !== undefined) {
        const path = item.locale ? `${item.path}.${item.locale}` : item.path;
        const edit = editFor(path, refs, viewLinks);
        hits.push({ path, term, excerpt: excerptAround(item.value, match.index, match[0].length), ...(edit ? { edit } : {}) });
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

type CollectOut = { jobDir: string; hooks: { signal?: AbortSignal; onAsset?: (done: number, total: number) => void } };

/**
 * Gemeinsamer Weg für Export und Hash-Abgleich. Mit `out === null` werden keine
 * Dateien angelegt und keine Originalbilder gelesen: Der Hash umfasst nur die
 * Metadaten der Assets (`canonical({ variables, collections, views, assets })`),
 * deshalb ist er ohne Kopie derselbe wie im Export.
 */
async function collect(
  deps: Deps,
  ctx: CallContext,
  templateDir: string,
  out: CollectOut | null,
): Promise<Result<{ contentHash: string; json: string; assets: ExportedAsset[] } & ExportChecks>> {
  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  // Vor `templateIsCurrent`, denn das lädt die Template-Datei — und genau das
  // soll ein Template aus einem eingespielten Archiv nicht tun, bevor ein
  // Mensch es angesehen hat. Siehe `review.ts`.
  //
  // Der Normalfall löst sich dabei von selbst: Wer sein eigenes Backup
  // einspielt, bringt sein eigenes Template mit, und der Abgleich gegen den
  // beiseitegeschobenen Stand nimmt die Prüfpflicht ohne Rückfrage weg.
  settleTemplateAfterImport(deps, ctx, templateDir, previousTemplateDir());
  if (templateNeedsReview(deps)) {
    return conflict('templateNeedsReview', 'Das Template kam mit einem Backup; es muss erst eingelesen werden');
  }
  if (!(await templateIsCurrent(deps, templateDir))) {
    return conflict('templateStale', 'Die Template-Datei weicht vom eingelesenen Stand ab; erst neu einlesen');
  }

  // Das Template fordert Sprachen, es bekommt nicht alle: Was der Verein darüber
  // hinaus pflegt, bleibt in der Datenbank und wird weder ausgeliefert noch als
  // Lücke gemeldet (Spec § 6 und § 8). Die Reihenfolge — Leitsprache zuerst —
  // ist die der Installation.
  const locales = deps.locales().filter((l) => template.schema.locales.includes(l));

  const variables = pruneLocales(readValues(deps), locales) as Record<string, unknown>;

  // Ein Verweis, der nicht mehr trägt, hält keinen Publish an, verschwindet
  // aber auch nicht still: null im Export, ein Befund im Ergebnis (Spec § 4.6).
  const staleRaw = checkReferenceValues(deps, template.schema, variables);
  const stale = staleRaw.map((s) => ({ path: `variables.${s.field}`, value: s.value }));
  for (const s of staleRaw) {
    const current = variables[s.field];
    variables[s.field] = Array.isArray(current) ? current.filter((v) => v !== s.value) : null;
  }

  const collections: Record<string, unknown[]> = {};
  // Je Sammlung die Zeilen in der Reihenfolge des Exports: Der Index im Pfad eines Treffers führt so zum Eintrag.
  const refs: Record<string, { id: string; title: string }[]> = {};
  for (const [key, col] of Object.entries(template.schema.collections)) {
    const rows = deps.db
      .select()
      .from(siteEntries)
      .where(eq(siteEntries.collection, key))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((row) => !col.publishable || row.isPublished);
    refs[key] = rows.map((row) => ({ id: row.id, title: entryLabel(col, row, locales[0] ?? '') }));
    collections[key] = rows.map((row) => ({
      ...(pruneLocales(row.data, locales) as Record<string, unknown>),
      ...(col.slug ? { slug: row.slug } : {}),
      ...(col.sortable ? { sortOrder: row.sortOrder } : {}),
    }));
  }

  const views: Record<string, unknown[]> = {};
  const viewLinks: ViewLinks = {};
  const addView = (view: { name: string; load(deps: Deps): unknown[]; editLink?(deps: Deps, row: never): { href: string; title: string } | null }) => {
    const rows = view.load(deps);
    views[view.name] = pruneLocales(rows, locales) as unknown[];
    if (view.editLink) viewLinks[view.name] = (i) => (rows[i] === undefined ? null : view.editLink!(deps, rows[i] as never));
  };
  // Die Sichten des Kerns sind immer dabei: Vereinsstammdaten pflegt man einmal
  // in den Einstellungen, kein Template soll sie als Variablen verdoppeln.
  for (const view of deps.registry.module('core')?.publishedViews ?? []) {
    addView(view);
  }
  for (const use of template.schema.uses) {
    const manifest = deps.registry.manifests.find((m) => m.key === use);
    if (!manifest || !isModuleEnabled(deps, use)) {
      return localizedConflict('moduleDisabled', 'errors.site.moduleDisabled', { module: use });
    }
    for (const view of manifest.publishedViews ?? []) {
      addView(view);
    }
  }

  // Was veröffentlicht ist und noch auf eine Prüfung wartet, melden die Module
  // selbst. Gefragt wird jedes eingeschaltete, nicht nur die unter `uses`:
  // Die Warnung gilt dem Bestand, nicht dem Template, und dieses Modul weiß
  // dabei nicht, wessen Datensätze es sind.
  const pendingReview: ExportChecks['pendingReview'] = [];
  for (const manifest of deps.registry.manifests) {
    if (manifest.key !== 'core' && !isModuleEnabled(deps, manifest.key)) continue;
    for (const view of manifest.publishedViews ?? []) {
      for (const item of view.pendingReview?.(deps) ?? []) pendingReview.push({ view: view.name, ...item });
    }
  }

  const ids = new Set<string>();
  assetIdsFromFields(template.schema.variables, variables, ids);
  for (const [key, col] of Object.entries(template.schema.collections)) {
    for (const entry of collections[key] ?? []) assetIdsFromFields(col.fields, entry, ids);
  }
  assetIdsFromViews(views, ids);
  const assets: ExportedAsset[] = [];
  if (out) await mkdir(path.join(out.jobDir, 'assets'), { recursive: true });
  let copied = 0;
  for (const id of [...ids].sort()) {
    out?.hooks.signal?.throwIfAborted();
    out?.hooks.onAsset?.(++copied, ids.size);
    const row = deps.db.select().from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get();
    if (!row) continue;
    assets.push({ id: row.id, filename: row.filename, mimeType: row.mimeType, width: row.width, height: row.height });
    if (out) await writeFile(path.join(out.jobDir, 'assets', row.filename), await deps.media.read(row.filename));
  }

  const contentPayload = { variables, collections, views };
  const json = JSON.stringify(canonical({ variables, collections, views, assets }), null, 2);
  const contentHash = createHash('sha256').update(json).digest('hex');

  const terms = deps.registry.settingDefinitions.has('site.blockedTerms')
    ? readSetting<string[]>(deps, 'site.blockedTerms')
    : [];
  const violations = collectViolations(contentPayload, terms, assets, refs, viewLinks);
  const gaps: { path: string; locale: string }[] = [];
  collectGaps(contentPayload, '', locales, gaps);

  return ok({ contentHash, json, assets, gaps, violations, stale, pendingReview });
}

/**
 * Schreibt `content.json` in der Form der Spec: Variablen, Sammlungen, Sichten,
 * Assets. Vorher prüft die Publish-Sicherung, dass die Datei im Volume dem
 * eingelesenen Stand entspricht.
 */
export async function exportSiteContent(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
  hooks: { signal?: AbortSignal; onAsset?: (done: number, total: number) => void } = {},
): Promise<Result<SiteContentExport>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  await siteTestBrake(deps, hooks.signal);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { type: 'validation', issues: [{ path: 'jobDir', message: 'required' }] } };
  const { jobDir } = parsed.data;
  const collected = await collect(deps, ctx, parsed.data.templateDir ?? siteTemplateDir(), { jobDir, hooks });
  if (!collected.ok) return collected;
  const { json, ...rest } = collected.value;
  const contentPath = path.join(jobDir, 'content.json');
  await writeFile(contentPath, json);
  return ok({ ...rest, contentPath });
}

/** Nur der Inhalts-Hash: gleicher Wert wie im Export, ohne Dateien und ohne die Originalbilder zu lesen. */
export async function siteContentHash(
  deps: Deps,
  ctx: CallContext,
  input: { templateDir?: string } = {},
): Promise<Result<{ contentHash: string; assets: number } & ExportChecks>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const collected = await collect(deps, ctx, input.templateDir ?? siteTemplateDir(), null);
  if (!collected.ok) return collected;
  const { json: _json, assets, ...rest } = collected.value;
  return ok({ ...rest, assets: assets.length });
}
