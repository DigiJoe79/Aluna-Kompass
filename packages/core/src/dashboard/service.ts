import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { dashboardLayouts } from '../db/schema';
import type { Deps } from '../deps';
import { enabledManifests } from '../modules/service';
import { hasAnyOf } from '../permissions/check';
import { forbidden, invalid, ok, type Result, type ValidationIssue } from '../result';
import { validate, zodIssue } from '../validate';
import { DASHBOARD_LAYOUTS, defaultArrangement, deriveArrangement, layoutColumnCount, legacyArrangement, otherLayout, shortestColumn, tileLength, type DashboardLayoutKind } from './arrangement';
import { dashboardOptionFields, type DashboardContent, type DashboardKind, type DashboardOptionField, type DashboardTile, type DashboardVariant } from './types';

export interface AvailableTile {
  module: string;
  key: string;
  kind: DashboardKind;
  /** Fällig oder Arbeit; `null` bei allen anderen. */
  variant: DashboardVariant | null;
  defaultOn: boolean;
  options: DashboardOptionField[];
}

export interface LayoutTile {
  module: string;
  key: string;
  options: Record<string, unknown>;
}

/**
 * Die Startseite eines Nutzers (Briefing Startseite § 1, § 5): ein aktives Layout und je Layout eine eigene Anordnung
 * als Spalten. `columns` ist die Anordnung des aktiven Layouts, drei Spalten bei `thirds`, zwei (breit, schmal) bei
 * `wide-narrow`. Was in keiner Spalte steht, ist aus.
 */
export interface DashboardLayout {
  layout: DashboardLayoutKind;
  columns: LayoutTile[][];
  /** Beide Layouts; das nie gespeicherte ist nach der Regel des ersten Wechsels aus dem aktiven abgeleitet. */
  arrangements: Record<DashboardLayoutKind, LayoutTile[][]>;
  /** true, wenn der Nutzer eine eigene Anordnung gespeichert hat. */
  custom: boolean;
}

export interface DashboardTileView {
  module: string;
  key: string;
  kind: DashboardKind;
  /** Fällig oder Arbeit; `null` bei allen anderen. */
  variant: DashboardVariant | null;
  /** Bei Ton `warning` ein Knopf mit Verb, Text `dashboard.tiles.<modul>.<key>.action`. */
  warningAction: boolean;
  /** Spalte im aktiven Layout, ab 0. Die Liste kommt Spalte für Spalte — die Reihenfolge am Telefon. */
  column: number;
  options: Record<string, unknown>;
  content: DashboardContent | null;
  /** `load` hat geworfen; die Kachel bleibt stehen, die anderen kommen durch (Entscheidung 11). */
  error: boolean;
}

const layoutTileInput = z.object({
  module: z.string().trim().min(1),
  key: z.string().trim().min(1),
  options: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Zwei Formen in einem Objekt: `{ layout, columns? }` setzt die Anordnung eines Layouts (ohne `columns`: nur umschalten,
 * die Anordnung bleibt, wie sie war), `{ tiles }` ist die flache Liste bis 0.2.11 und wird verteilt. Ein Objekt statt
 * `z.union`, weil ein MCP-Werkzeugschema oben `type: object` sein muss. Welche Form gilt, prüft der Dienst, nicht das
 * Schema (Wächter `mcp-conditional-required`: keine Pflicht abhängig von einem anderen Feld im Werkzeugschema).
 */
export const dashboardLayoutSchema = z.object({
  layout: z.enum(DASHBOARD_LAYOUTS).optional(),
  columns: z.array(z.array(layoutTileInput).max(50)).max(3).optional(),
  tiles: z.array(layoutTileInput).max(50).optional(),
});

interface Placed {
  module: string;
  tile: DashboardTile;
}

/** Die Kacheln, die dieser Nutzer sehen darf: eingeschaltete Module, in Registry-Reihenfolge, gefiltert nach Recht. */
function availableTiles(deps: Deps, ctx: CallContext): Placed[] {
  return enabledManifests(deps).flatMap((m) =>
    (m.dashboardTiles ?? [])
      .filter((tile) => hasAnyOf(ctx.permissions, tile.permission) && (tile.available?.(deps) ?? true))
      .map((tile) => ({ module: m.key, tile })),
  );
}

const find = (available: Placed[], module: string, key: string): Placed | undefined =>
  available.find((p) => p.module === module && p.tile.key === key);

/**
 * Optionen je Feld gegen das Schema: Was passt, bleibt; was nicht passt,
 * fällt auf die Vorgabe zurück — je Feld, nicht alles oder nichts, damit eine
 * umbenannte Option nicht die anderen mitreißt.
 */
function settleOptions(tile: DashboardTile, stored: Record<string, unknown>): Record<string, unknown> {
  const defaults = tile.options.parse({}) as Record<string, unknown>;
  const result: Record<string, unknown> = { ...defaults };
  for (const field of dashboardOptionFields(tile.options)) {
    if (!(field.name in stored)) continue;
    const single = tile.options.safeParse({ [field.name]: stored[field.name] });
    if (single.success) result[field.name] = (single.data as Record<string, unknown>)[field.name];
  }
  return result;
}

const requireUser = (ctx: CallContext): string | null => ctx.userId;

/** Gespeichert ab 0.2.12, als JSON in `dashboard_layouts.tiles` (keine Migration). */
interface StoredArrangement {
  v: 2;
  layout: DashboardLayoutKind;
  arrangements: Partial<Record<DashboardLayoutKind, LayoutTile[][]>>;
}

/** Was in der Zeile steht: nichts, die flache Liste bis 0.2.11 oder die Spalten ab 0.2.12. */
type Stored = { format: 'legacy'; tiles: LayoutTile[] } | { format: 'columns'; value: StoredArrangement };

const isLayoutKind = (value: unknown): value is DashboardLayoutKind => (DASHBOARD_LAYOUTS as readonly unknown[]).includes(value);

function storedEntries(value: unknown): LayoutTile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): LayoutTile[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { module, key, options } = entry as Record<string, unknown>;
    if (typeof module !== 'string' || typeof key !== 'string') return [];
    return [{ module, key, options: typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {} }];
  });
}

function readStored(deps: Deps, userId: string): { raw: unknown; stored: Stored } | null {
  const row = deps.db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).get();
  if (!row) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(row.tiles) as unknown;
  } catch {
    return { raw: null, stored: { format: 'legacy', tiles: [] } };
  }
  if (Array.isArray(raw)) return { raw, stored: { format: 'legacy', tiles: storedEntries(raw) } };
  const object = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (object.v !== 2 || !isLayoutKind(object.layout)) return { raw, stored: { format: 'legacy', tiles: [] } };
  const source = typeof object.arrangements === 'object' && object.arrangements !== null ? (object.arrangements as Record<string, unknown>) : {};
  const arrangements: StoredArrangement['arrangements'] = {};
  for (const layout of DASHBOARD_LAYOUTS) {
    const columns = source[layout];
    if (Array.isArray(columns)) arrangements[layout] = columns.map(storedEntries);
  }
  return { raw, stored: { format: 'columns', value: { v: 2, layout: object.layout, arrangements } } };
}

/** Geschätzte Länge einer Kachel, die der Nutzer sehen darf (nur solche kommen hier an). */
const lengthIn = (available: Placed[]) => (entry: LayoutTile): number => tileLength(find(available, entry.module, entry.key)?.tile.kind ?? 'count');

/**
 * Spalten auf die Zahl des Layouts gebracht (überzählige hängen an der letzten), Kacheln ohne Recht oder mit
 * ausgeschaltetem Modul weggelassen (nicht gelöscht), doppelte nur einmal, Optionen gegen das Schema.
 */
function settleColumns(available: Placed[], columns: LayoutTile[][], count: number): LayoutTile[][] {
  const shaped: LayoutTile[][] = Array.from({ length: count }, (_, i) => (i < count - 1 ? (columns[i] ?? []) : columns.slice(count - 1).flat()));
  const seen = new Set<string>();
  return shaped.map((column) =>
    column.flatMap((entry) => {
      const placed = find(available, entry.module, entry.key);
      const id = `${entry.module}.${entry.key}`;
      if (!placed || seen.has(id)) return [];
      seen.add(id);
      return [{ module: placed.module, key: placed.tile.key, options: settleOptions(placed.tile, entry.options ?? {}) }];
    }),
  );
}

/** Vorgabe-Layout: 2:1, wer eine Arbeit-Kachel sehen darf (heute „Finanzen: zu tun“, Recht `finance.read`); sonst drei gleiche. */
function defaultLayoutFor(available: Placed[]): DashboardLayoutKind {
  return available.some((p) => p.tile.variant === 'work') ? 'wide-narrow' : 'thirds';
}

function withDerived(available: Placed[], layout: DashboardLayoutKind, columns: LayoutTile[][], custom: boolean): DashboardLayout {
  const other = otherLayout(layout);
  const arrangements = { [layout]: columns, [other]: deriveArrangement(columns, layout, lengthIn(available)) } as Record<DashboardLayoutKind, LayoutTile[][]>;
  return { layout, columns, arrangements, custom };
}

function resolveFrom(available: Placed[], stored: Stored | null): DashboardLayout {
  const length = lengthIn(available);
  if (stored === null) {
    const layout = defaultLayoutFor(available);
    const tiles = available.filter((p) => p.tile.defaultOn).map((p) => ({ module: p.module, key: p.tile.key, options: settleOptions(p.tile, {}) }));
    return withDerived(available, layout, defaultArrangement(tiles, layout, length), false);
  }
  if (stored.format === 'legacy') {
    const layout = defaultLayoutFor(available);
    const [tiles] = settleColumns(available, [stored.tiles], 1);
    return withDerived(available, layout, legacyArrangement(tiles!, layout, length), true);
  }
  const { layout, arrangements } = stored.value;
  const other = otherLayout(layout);
  const ownRaw = arrangements[layout];
  const otherRaw = arrangements[other];
  if (!ownRaw) {
    const columns = otherRaw ? deriveArrangement(settleColumns(available, otherRaw, layoutColumnCount(other)), other, length) : [];
    return withDerived(available, layout, settleColumns(available, columns, layoutColumnCount(layout)), true);
  }
  const columns = settleColumns(available, ownRaw, layoutColumnCount(layout));
  if (!otherRaw) return withDerived(available, layout, columns, true);
  const derived = { [layout]: columns, [other]: settleColumns(available, otherRaw, layoutColumnCount(other)) } as Record<DashboardLayoutKind, LayoutTile[][]>;
  return { layout, columns, arrangements: derived, custom: true };
}

function resolveLayout(deps: Deps, ctx: CallContext, userId: string): DashboardLayout {
  return resolveFrom(availableTiles(deps, ctx), readStored(deps, userId)?.stored ?? null);
}

export async function listDashboardTiles(deps: Deps, ctx: CallContext): Promise<Result<AvailableTile[]>> {
  if (!requireUser(ctx)) return forbidden('session');
  return ok(
    availableTiles(deps, ctx).map((p) => ({
      module: p.module,
      key: p.tile.key,
      kind: p.tile.kind,
      variant: p.tile.variant ?? null,
      defaultOn: p.tile.defaultOn,
      options: dashboardOptionFields(p.tile.options),
    })),
  );
}

export async function getDashboardLayout(deps: Deps, ctx: CallContext): Promise<Result<DashboardLayout>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  return ok(resolveLayout(deps, ctx, userId));
}

const tileId = (entry: LayoutTile): string => `${entry.module}.${entry.key}`;

/**
 * Ein- und ausgeschaltet gilt für beide Layouts gemeinsam, nur die Anordnung merkt sich jedes für sich (Vorgaben
 * Teil M, Entscheidung 1): Was im gespeicherten Layout wegfiel, fällt auch aus dem anderen; was dazukam, steht dort am
 * Ende der kürzesten Spalte. Kacheln, die der Nutzer gerade nicht sieht (Recht, Modul aus), bleiben unberührt.
 */
function followOnOff(previous: LayoutTile[][], next: LayoutTile[][], other: LayoutTile[][], length: (entry: LayoutTile) => number): LayoutTile[][] {
  const was = new Set(previous.flat().map(tileId));
  const now = new Set(next.flat().map(tileId));
  const result = other.map((column) => column.filter((entry) => !was.has(tileId(entry)) || now.has(tileId(entry))));
  const present = new Set(result.flat().map(tileId));
  for (const entry of next.flat()) {
    if (was.has(tileId(entry)) || present.has(tileId(entry))) continue;
    result[shortestColumn(result, length)]!.push(entry);
    present.add(tileId(entry));
  }
  return result;
}

export async function setDashboardLayout(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DashboardLayout>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  const parsed = validate(deps, dashboardLayoutSchema, input);
  if (!parsed.ok) return parsed;
  if (parsed.value.tiles !== undefined && (parsed.value.layout !== undefined || parsed.value.columns !== undefined)) return invalid([{ path: 'tiles', message: 'tilesOrLayout' }]);
  if (parsed.value.tiles === undefined && parsed.value.layout === undefined) return invalid([{ path: 'layout', message: 'required' }]);

  const available = availableTiles(deps, ctx);
  const length = lengthIn(available);
  const allMounted = enabledManifests(deps).flatMap((m) => (m.dashboardTiles ?? []).map((tile) => ({ module: m.key, tile })));
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  /** Eine Kachel der Eingabe: Recht, Bekanntheit, Doppelung und Optionen wie bis 0.2.11, nur mit Pfad je Form. */
  const accept = (entry: z.infer<typeof layoutTileInput>, path: string): LayoutTile | null => {
    const id = `${entry.module}.${entry.key}`;
    if (seen.has(id)) {
      issues.push({ path, message: 'duplicateTile' });
      return null;
    }
    seen.add(id);
    const placed = find(available, entry.module, entry.key);
    if (!placed) {
      issues.push({ path, message: find(allMounted, entry.module, entry.key) ? 'forbiddenTile' : 'unknownTile' });
      return null;
    }
    const options = placed.tile.options.safeParse(entry.options);
    if (!options.success) {
      for (const issue of options.error.issues) issues.push(zodIssue(issue, `${path}.options`));
      return null;
    }
    return { module: placed.module, key: placed.tile.key, options: options.data as Record<string, unknown> };
  };

  const before = readStored(deps, userId);
  const current = resolveFrom(available, before?.stored ?? null);
  const kept = before?.stored.format === 'columns' ? before.stored.value.arrangements : {};
  const { layout: requested, columns: requestedColumns, tiles } = parsed.value;
  let next: StoredArrangement;
  if (tiles !== undefined) {
    // Die flache Liste: aufs aktive Layout verteilt, das andere daraus abgeleitet — die Liste bestimmt, was an ist.
    const flat = tiles.flatMap((entry, index) => accept(entry, `tiles.${index}`) ?? []);
    const columns = legacyArrangement(flat, current.layout, length);
    next = { v: 2, layout: current.layout, arrangements: { [current.layout]: columns, [otherLayout(current.layout)]: deriveArrangement(columns, current.layout, length) } };
  } else {
    const layout = requested!;
    // Was nicht geschrieben wird, bleibt, wie es war: gespeichert samt verborgener Kacheln, sonst wie bisher abgeleitet.
    const arrangements: StoredArrangement['arrangements'] = {};
    for (const each of DASHBOARD_LAYOUTS) arrangements[each] = kept[each] ?? current.arrangements[each];
    if (requestedColumns !== undefined) {
      if (requestedColumns.length !== layoutColumnCount(layout)) issues.push({ path: 'columns', message: 'columnCount', params: { count: layoutColumnCount(layout) } });
      else {
        const columns = requestedColumns.map((column, c) => column.flatMap((entry, i) => accept(entry, `columns.${c}.${i}`) ?? []));
        arrangements[layout] = columns;
        arrangements[otherLayout(layout)] = followOnOff(current.arrangements[layout], columns, arrangements[otherLayout(layout)] ?? [], length);
      }
    }
    next = { v: 2, layout, arrangements };
  }
  if (issues.length > 0) return invalid(issues);

  return deps.db.transaction((tx) => {
    const json = JSON.stringify(next);
    const now = isoNow(deps.clock);
    tx.insert(dashboardLayouts)
      .values({ userId, tiles: json, updatedAt: now })
      .onConflictDoUpdate({ target: dashboardLayouts.userId, set: { tiles: json, updatedAt: now } })
      .run();
    const result = resolveFrom(available, { format: 'columns', value: next });
    recordAudit(tx, deps, ctx, {
      action: 'dashboard.setLayout',
      entityType: 'dashboardLayout',
      entityId: userId,
      before: before?.raw ?? null,
      after: next,
      params: { tileCount: result.columns.flat().length },
    });
    return ok(result);
  });
}

export async function resetDashboardLayout(deps: Deps, ctx: CallContext): Promise<Result<DashboardLayout>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  const before = readStored(deps, userId);
  if (before !== null) {
    deps.db.transaction((tx) => {
      tx.delete(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).run();
      recordAudit(tx, deps, ctx, {
        action: 'dashboard.resetLayout',
        entityType: 'dashboardLayout',
        entityId: userId,
        before: before.raw,
        after: null,
      });
    });
  }
  return ok(resolveLayout(deps, ctx, userId));
}

export async function readDashboard(deps: Deps, ctx: CallContext): Promise<Result<DashboardTileView[]>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  const available = availableTiles(deps, ctx);
  const layout = resolveLayout(deps, ctx, userId);
  const views: DashboardTileView[] = [];
  for (const [column, entries] of layout.columns.entries()) {
    for (const entry of entries) {
      const placed = find(available, entry.module, entry.key)!;
      const base = { module: entry.module, key: entry.key, kind: placed.tile.kind, variant: placed.tile.variant ?? null, warningAction: placed.tile.warningAction ?? false, column, options: entry.options };
      try {
        const content = await placed.tile.load(deps, ctx, entry.options);
        views.push({ ...base, content, error: false });
      } catch (error) {
        // Der Fehler gehört ins Serverprotokoll, nicht an den Aufrufer: Die Kachel
        // zeigt einen Satz, die anderen bleiben stehen (Entscheidung 11).
        console.error(`[dashboard] tile ${entry.module}.${entry.key} failed`, error);
        views.push({ ...base, content: null, error: true });
      }
    }
  }
  return ok(views);
}
