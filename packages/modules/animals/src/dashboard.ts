import type { DashboardTile } from '@kompass/core';
import { count, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { animals } from './schema';

/**
 * Die Kachel der Tiere (Spec 2026-09-30, § 10): wie viele Profile auf eine
 * Prüfung warten. Sie ist die Arbeitsliste und zählt deshalb auch
 * unveröffentlichte Profile; der Link führt in genau diese Auswahl der Liste.
 * Das Recht prüft der Kern vor dem Aufruf.
 */
const reviewPendingTile: DashboardTile<Record<string, never>> = {
  key: 'reviewPending',
  permission: 'animals.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  async load(deps) {
    const row = deps.db.select({ n: count() }).from(animals).where(isNotNull(animals.reviewRequestedAt)).get();
    return { kind: 'count', count: row?.n ?? 0, href: '/animals?review=1' };
  },
};

export const ANIMALS_DASHBOARD_TILES: readonly DashboardTile[] = [reviewPendingTile as DashboardTile];
