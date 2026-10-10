import { conflict, isModuleEnabled, ok, requirePermission, schema as core, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contentManifestOf, readPublicContent, type ContentManifest, type PublicItem } from './public-content';
import { sitePublishes } from './schema';
import { activeTemplate } from './service';

/** Als Stand der Webseite gilt nur ein Publish der Produktion; ein Lauf auf Test zählt nicht (Spec Vorschläge § 6). */
export const BASELINE_ENVIRONMENT = 'production';

export type PendingKind = 'changed' | 'added' | 'removed';
export interface PendingChange {
  key: string;
  kind: PendingKind;
  label: string;
  /** Link zum Bearbeiten; null bei „von der Webseite genommen“, weil der Datensatz gelöscht sein kann (Entscheidung 2026-10-10). */
  href: string | null;
  /** Adresse des Datensatzes, auch wenn er von der Webseite genommen ist — für die Zeile am Datensatz selbst. */
  recordHref: string | null;
}
export interface PendingState {
  /** Beginn des Publish, gegen den verglichen wird; null = noch keiner mit festgehaltenem Stand (dann count 0). */
  since: string | null;
  count: number;
  /** Nach Name sortiert (Leitsprache der Installation). */
  items: PendingChange[];
}
export interface PendingChanges extends PendingState { truncated: boolean }

const NONE: PendingState = { since: null, count: 0, items: [] };

export function diffPublicState(baseline: ContentManifest, current: readonly PublicItem[], locale: string): PendingChange[] {
  const seen = new Set<string>();
  const out: PendingChange[] = [];
  for (const item of current) {
    seen.add(item.key);
    const before = baseline[item.key];
    if (!before) out.push({ key: item.key, kind: 'added', label: item.label, href: item.href, recordHref: item.href });
    else if (before.hash !== item.hash) out.push({ key: item.key, kind: 'changed', label: item.label, href: item.href, recordHref: item.href });
  }
  for (const [key, before] of Object.entries(baseline)) {
    // Name aus dem festgehaltenen Stand: Den Datensatz gibt es vielleicht nicht mehr — deshalb auch kein Link.
    if (!seen.has(key)) out.push({ key, kind: 'removed', label: before.label, href: null, recordHref: before.href });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, locale) || a.key.localeCompare(b.key));
}

/** Der heutige öffentliche Stand als Manifest — für die E2E-Route. null ohne Template oder bei ausgeschaltetem Modul. */
export function currentContentManifest(deps: Deps): ContentManifest | null {
  const template = activeTemplate(deps);
  if (!template) return null;
  const content = readPublicContent(deps, template);
  return content.ok ? contentManifestOf(content.value.items) : null;
}

function compute(deps: Deps): PendingState {
  const template = activeTemplate(deps);
  if (!template) return NONE;
  // Nur der jüngste Erfolg zählt; hat er keinen festgehaltenen Stand (vor 0.2.10), gibt es keinen Vergleich — nie „alles neu“.
  const baseline = deps.db
    .select({ startedAt: sitePublishes.startedAt, manifest: sitePublishes.contentManifest })
    .from(sitePublishes)
    .where(and(eq(sitePublishes.environment, BASELINE_ENVIRONMENT), eq(sitePublishes.status, 'success')))
    .orderBy(desc(sitePublishes.startedAt))
    .get();
  if (!baseline?.manifest) return NONE;
  const content = readPublicContent(deps, template);
  if (!content.ok) return NONE;
  const items = diffPublicState(JSON.parse(baseline.manifest) as ContentManifest, content.value.items, deps.locales()[0] ?? 'en');
  return { since: baseline.startedAt, count: items.length, items };
}

type Cache = WeakMap<object, { stamp: number; value: PendingState | null }>;
/** Auf `globalThis`: Die Route-Bündel von Next teilen keine Modulvariablen (vgl. `pipeline/run-state.ts`). */
const cache = (): Cache => ((globalThis as { __kompassSitePending?: Cache }).__kompassSitePending ??= new WeakMap());

/**
 * Jede schreibende Aktion protokolliert in ihrer Transaktion (Prinzip 3) — die höchste Zeile des Protokolls ist
 * deshalb der Stand der Daten. Ein Treffer kostet diese eine Abfrage; neu gerechnet wird nur nach einem Schreiben.
 */
const dataStamp = (deps: Deps): number => deps.db.select({ n: sql<number | null>`max(rowid)` }).from(core.auditLog).get()?.n ?? 0;

/**
 * Ohne Rechteprüfung, gecacht bis zur nächsten Zeile im Änderungsprotokoll. null, wenn eine Sicht beim Lesen wirft:
 * Der Poller `/site/job` zeigt auch laufende Läufe und darf an diesem Zusatz nicht scheitern — die Anzeige fällt aus,
 * der Fehler steht einmal im Log (der Cache hält das null bis zum nächsten Schreiben).
 */
export function computePendingChanges(deps: Deps): PendingState | null {
  const stamp = dataStamp(deps);
  const hit = cache().get(deps.db);
  if (hit && hit.stamp === stamp) return hit.value;
  let value: PendingState | null;
  try {
    value = compute(deps);
  } catch (error) {
    console.error('[site] Nicht publizierte Änderungen ließen sich nicht ermitteln', error);
    value = null;
  }
  cache().set(deps.db, { stamp, value });
  return value;
}

const inputSchema = z.object({ limit: z.number().int().min(1).max(500).optional() });

/** Was seit dem letzten erfolgreichen Publish der Produktion öffentlich anders ist (Plan C). Ohne `limit` alles. */
export async function sitePendingChanges(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<PendingChanges>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = validate(deps, inputSchema, input);
  if (!parsed.ok) return parsed;
  const all = isModuleEnabled(deps, 'site') ? computePendingChanges(deps) : NONE;
  if (!all) return conflict('pendingUnavailable', 'Der öffentliche Stand ließ sich gerade nicht lesen; die Ursache steht im Serverprotokoll');
  const limit = parsed.value.limit ?? all.items.length;
  return ok({ ...all, items: all.items.slice(0, limit), truncated: all.items.length > limit });
}
