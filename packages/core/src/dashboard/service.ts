import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { dashboardLayouts } from '../db/schema';
import type { Deps } from '../deps';
import { enabledManifests } from '../modules/service';
import { hasPermission } from '../permissions/check';
import { forbidden, invalid, ok, type Result, type ValidationIssue } from '../result';
import { validate } from '../validate';
import { dashboardOptionFields, type DashboardContent, type DashboardKind, type DashboardOptionField, type DashboardTile } from './types';

export interface AvailableTile {
  module: string;
  key: string;
  kind: DashboardKind;
  defaultOn: boolean;
  options: DashboardOptionField[];
}

export interface LayoutTile {
  module: string;
  key: string;
  options: Record<string, unknown>;
}

export interface DashboardLayout {
  tiles: LayoutTile[];
  /** true, wenn der Nutzer eine eigene Anordnung gespeichert hat. */
  custom: boolean;
}

export interface DashboardTileView {
  module: string;
  key: string;
  kind: DashboardKind;
  options: Record<string, unknown>;
  content: DashboardContent | null;
  /** `load` hat geworfen; die Kachel bleibt stehen, die anderen kommen durch (Entscheidung 11). */
  error: boolean;
}

export const dashboardLayoutSchema = z.object({
  tiles: z
    .array(
      z.object({
        module: z.string().trim().min(1),
        key: z.string().trim().min(1),
        options: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(50),
});

interface Placed {
  module: string;
  tile: DashboardTile;
}

/** Die Kacheln, die dieser Nutzer sehen darf: eingeschaltete Module, in Registry-Reihenfolge, gefiltert nach Recht. */
function availableTiles(deps: Deps, ctx: CallContext): Placed[] {
  return enabledManifests(deps).flatMap((m) =>
    (m.dashboardTiles ?? []).filter((tile) => hasPermission(ctx, tile.permission)).map((tile) => ({ module: m.key, tile })),
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

function storedTiles(deps: Deps, userId: string): LayoutTile[] | null {
  const row = deps.db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.tiles) as unknown;
    return Array.isArray(parsed) ? (parsed as LayoutTile[]) : [];
  } catch {
    return [];
  }
}

function resolveLayout(deps: Deps, ctx: CallContext, userId: string): DashboardLayout {
  const available = availableTiles(deps, ctx);
  const stored = storedTiles(deps, userId);
  if (stored === null) {
    return {
      custom: false,
      tiles: available.filter((p) => p.tile.defaultOn).map((p) => ({ module: p.module, key: p.tile.key, options: settleOptions(p.tile, {}) })),
    };
  }
  const tiles: LayoutTile[] = [];
  for (const entry of stored) {
    const placed = find(available, entry.module, entry.key);
    if (!placed) continue; // Modul aus oder Recht weg: weglassen, nicht löschen
    tiles.push({ module: placed.module, key: placed.tile.key, options: settleOptions(placed.tile, entry.options ?? {}) });
  }
  return { custom: true, tiles };
}

export async function listDashboardTiles(deps: Deps, ctx: CallContext): Promise<Result<AvailableTile[]>> {
  if (!requireUser(ctx)) return forbidden('session');
  return ok(
    availableTiles(deps, ctx).map((p) => ({
      module: p.module,
      key: p.tile.key,
      kind: p.tile.kind,
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

export async function setDashboardLayout(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DashboardLayout>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  const parsed = validate(deps, dashboardLayoutSchema, input);
  if (!parsed.ok) return parsed;

  const available = availableTiles(deps, ctx);
  const allMounted = enabledManifests(deps).flatMap((m) => (m.dashboardTiles ?? []).map((tile) => ({ module: m.key, tile })));
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const tiles: LayoutTile[] = [];
  parsed.value.tiles.forEach((entry, index) => {
    const id = `${entry.module}.${entry.key}`;
    if (seen.has(id)) {
      issues.push({ path: `tiles.${index}`, message: 'duplicateTile' });
      return;
    }
    seen.add(id);
    const placed = find(available, entry.module, entry.key);
    if (!placed) {
      issues.push({ path: `tiles.${index}`, message: find(allMounted, entry.module, entry.key) ? 'forbiddenTile' : 'unknownTile' });
      return;
    }
    const options = placed.tile.options.safeParse(entry.options);
    if (!options.success) {
      for (const issue of options.error.issues) issues.push({ path: `tiles.${index}.options.${issue.path.join('.')}`, message: issue.message });
      return;
    }
    tiles.push({ module: placed.module, key: placed.tile.key, options: options.data as Record<string, unknown> });
  });
  if (issues.length > 0) return invalid(issues);

  return deps.db.transaction((tx) => {
    const before = storedTiles(deps, userId);
    const now = isoNow(deps.clock);
    tx.insert(dashboardLayouts)
      .values({ userId, tiles: JSON.stringify(tiles), updatedAt: now })
      .onConflictDoUpdate({ target: dashboardLayouts.userId, set: { tiles: JSON.stringify(tiles), updatedAt: now } })
      .run();
    recordAudit(tx, deps, ctx, {
      action: 'dashboard.setLayout',
      entityType: 'dashboardLayout',
      entityId: userId,
      before,
      after: tiles,
      summary: `Startseite angeordnet: ${tiles.length} Kacheln`,
    });
    return ok({ custom: true, tiles });
  });
}

export async function resetDashboardLayout(deps: Deps, ctx: CallContext): Promise<Result<DashboardLayout>> {
  const userId = requireUser(ctx);
  if (!userId) return forbidden('session');
  const before = storedTiles(deps, userId);
  if (before !== null) {
    deps.db.transaction((tx) => {
      tx.delete(dashboardLayouts).where(eq(dashboardLayouts.userId, userId)).run();
      recordAudit(tx, deps, ctx, {
        action: 'dashboard.resetLayout',
        entityType: 'dashboardLayout',
        entityId: userId,
        before,
        after: null,
        summary: 'Startseite auf die Vorgabe zurückgesetzt',
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
  for (const entry of layout.tiles) {
    const placed = find(available, entry.module, entry.key)!;
    try {
      const content = await placed.tile.load(deps, ctx, entry.options);
      views.push({ module: entry.module, key: entry.key, kind: placed.tile.kind, options: entry.options, content, error: false });
    } catch (error) {
      // Der Fehler gehört ins Serverprotokoll, nicht an den Aufrufer: Die Kachel
      // zeigt einen Satz, die anderen bleiben stehen (Entscheidung 11).
      console.error(`[dashboard] tile ${entry.module}.${entry.key} failed`, error);
      views.push({ module: entry.module, key: entry.key, kind: placed.tile.kind, options: entry.options, content: null, error: true });
    }
  }
  return ok(views);
}
