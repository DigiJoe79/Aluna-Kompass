import { createHash } from 'node:crypto';
import { isModuleEnabled, localizedConflict, ok, type Deps, type PublishedView, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { entryLabel } from './entry-label';
import { checkReferenceValues } from './reference-fields';
import { siteEntries } from './schema';
import type { StoredTemplate } from './service';
import { readValues } from './values';

const LOCALE_KEY = /^[a-z]{2}(-[a-z]{2})?$/;

export const isLocalizedMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => LOCALE_KEY.test(k));

/** Wirft jede Sprache weg, die diese Installation nicht führt — auch Restmüll einer entfernten. */
export function pruneLocales(value: unknown, locales: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => pruneLocales(v, locales));
  if (isLocalizedMap(value)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => locales.includes(k)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pruneLocales(v, locales)]));
  }
  return value;
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** Fragt die Sicht erst beim Treffer nach dem Weg zur Zeile; `rows` sind die Zeilen des Exports in seiner Reihenfolge. */
export type ViewLinks = Record<string, (index: number) => { href: string; title: string } | null>;

export interface PublicItem { key: string; hash: string; label: string; href: string | null }
export type ContentManifest = Record<string, { hash: string; label: string; href: string | null }>;
export interface PublicContent {
  locales: string[];
  variables: Record<string, unknown>;
  stale: { path: string; value: string }[];
  collections: Record<string, unknown[]>;
  refs: Record<string, { id: string; title: string }[]>;
  views: Record<string, unknown[]>;
  viewLinks: ViewLinks;
  items: PublicItem[];
}

const hashOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex').slice(0, 16);

/**
 * Was die Vorlage bekäme, ohne etwas zu schreiben und ohne die Template-Datei zu lesen: Variablen, Sammlungen,
 * Sichten — und je Datensatz seine öffentliche Form als `PublicItem` (Plan C „nicht publiziert“). Interne Felder sind
 * nicht drin, weil die Sichten jede Zeile durch ihr Zod-Schema parsen; fremde Sprachen nicht, weil `pruneLocales`
 * sie vorher abschneidet. `collect` (Export) und `computePendingChanges` lesen beide hierüber.
 */
export function readPublicContent(deps: Deps, template: StoredTemplate): Result<PublicContent> {
  // Das Template fordert Sprachen, es bekommt nicht alle (Spec § 6 und § 8); Reihenfolge der Installation.
  const locales = deps.locales().filter((l) => template.schema.locales.includes(l));
  const items: PublicItem[] = [];

  const variables = pruneLocales(readValues(deps), locales) as Record<string, unknown>;
  // Ein Verweis, der nicht mehr trägt: null im Export, ein Befund im Ergebnis (Spec § 4.6).
  const staleRaw = checkReferenceValues(deps, template.schema, variables);
  const stale = staleRaw.map((s) => ({ path: `variables.${s.field}`, value: s.value }));
  for (const s of staleRaw) {
    const current = variables[s.field];
    variables[s.field] = Array.isArray(current) ? current.filter((v) => v !== s.value) : null;
  }
  for (const [name, field] of Object.entries(template.schema.variables)) {
    items.push({ key: `variables.${name}`, hash: hashOf(variables[name]), label: field.label || name, href: '/site/variables' });
  }

  const collections: Record<string, unknown[]> = {};
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
    rows.forEach((row, i) => items.push({ key: `entries.${key}.${row.id}`, hash: hashOf(collections[key]![i]), label: refs[key]![i]!.title, href: `/site/c/${key}/${row.id}` }));
  }

  const views: Record<string, unknown[]> = {};
  const viewLinks: ViewLinks = {};
  const addView = (view: PublishedView) => {
    const rows = view.load(deps);
    const pruned = pruneLocales(rows, locales) as unknown[];
    views[view.name] = pruned;
    if (view.editLink) viewLinks[view.name] = (i) => (rows[i] === undefined ? null : view.editLink!(deps, rows[i] as never));
    pruned.forEach((row, i) => {
      // Die Zeile hat keine ID; `editLink` schlägt den Datensatz nach. Seine Adresse bleibt, wenn sich der Slug ändert.
      const link = view.editLink?.(deps, rows[i] as never) ?? null;
      const slug = (row as { slug?: unknown }).slug;
      const fallback = typeof slug === 'string' && slug ? slug : String(i + 1);
      items.push({ key: `views.${view.name}:${link?.href ?? `#${fallback}`}`, hash: hashOf(row), label: link?.title || fallback, href: link?.href ?? null });
    });
  };
  // Die Sichten des Kerns sind immer dabei (Vereinsstammdaten).
  for (const view of deps.registry.module('core')?.publishedViews ?? []) addView(view);
  for (const use of template.schema.uses) {
    const manifest = deps.registry.manifests.find((m) => m.key === use);
    if (!manifest || !isModuleEnabled(deps, use)) {
      return localizedConflict('moduleDisabled', 'errors.site.moduleDisabled', { module: use });
    }
    for (const view of manifest.publishedViews ?? []) addView(view);
  }

  return ok({ locales, variables, stale, collections, refs, views, viewLinks, items });
}

export function contentManifestOf(items: readonly PublicItem[]): ContentManifest {
  return Object.fromEntries(items.map((i) => [i.key, { hash: i.hash, label: i.label, href: i.href }]));
}
