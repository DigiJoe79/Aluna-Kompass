import { readSetting, type DashboardTile, type Deps } from '@kompass/core';
import { count, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { listProposals } from './proposals/review';
import { animalProposals, animals } from './schema';
import { PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY } from './settings';

const DAY_MS = 86_400_000;
const openCount = (deps: Deps) => deps.db.select({ n: count() }).from(animalProposals).where(eq(animalProposals.state, 'open')).get()?.n ?? 0;
const markedCount = (deps: Deps) => deps.db.select({ n: count() }).from(animals).where(isNotNull(animals.reviewRequestedAt)).get()?.n ?? 0;

/**
 * Die Kachel der Tiere (Spec 2026-09-30, § 10): wie viele Profile auf eine
 * Prüfung warten. Sie ist die Arbeitsliste und zählt deshalb auch
 * unveröffentlichte Profile; der Link führt in genau diese Auswahl der Liste.
 * Das Recht prüft der Kern vor dem Aufruf. Ohne die Einstellung „Schreiben über
 * MCP zur Prüfung vormerken“ steht sie nur, solange noch Tiere markiert sind
 * (Spec Vorschläge § 4).
 */
const reviewPendingTile: DashboardTile<Record<string, never>> = {
  key: 'reviewPending',
  permission: 'animals.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  available: (deps) => readSetting<boolean>(deps, REVIEW_ON_MCP_WRITE_KEY) === true || markedCount(deps) > 0,
  async load(deps) {
    return { kind: 'count', count: markedCount(deps), href: '/animals?review=1' };
  },
};

/**
 * Board Vorschläge 1b: Zahl, Alter des ältesten (in Tagen), davon mit Konflikt.
 * Ohne Einstellung nur, solange noch welche offen sind (Spec § 4).
 */
const proposalsOpenTile: DashboardTile<Record<string, never>> = {
  key: 'proposalsOpen',
  permission: 'animals.manage',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['oldest'],
  available: (deps) => readSetting<boolean>(deps, PROPOSALS_ENABLED_KEY) === true || openCount(deps) > 0,
  async load(deps, ctx) {
    const list = await listProposals(deps, ctx, { state: 'open' });
    if (!list.ok) return { kind: 'count', count: 0, href: '/animals/proposals' };
    const { count: n, oldestAt, withConflict } = list.value.open;
    if (n === 0) return { kind: 'count', count: 0, href: '/animals/proposals' };
    const days = oldestAt ? Math.max(0, Math.floor((deps.clock.now().getTime() - Date.parse(oldestAt)) / DAY_MS)) : 0;
    return { kind: 'count', count: n, href: '/animals/proposals', note: { messageKey: 'oldest', values: { days, conflicts: withConflict } } };
  },
};

export const ANIMALS_DASHBOARD_TILES: readonly DashboardTile[] = [reviewPendingTile as DashboardTile, proposalsOpenTile as DashboardTile];
