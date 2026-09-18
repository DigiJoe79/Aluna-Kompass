import type { DashboardContent, DashboardTile } from '@kompass/core';
import { count, gt } from 'drizzle-orm';
import { z } from 'zod';
import { templateNeedsReview } from './review';
import { siteEntries, siteValues } from './schema';
import { lastPublish, lastSuccessfulPublish } from './services/publishes';

/**
 * Eine Kachel mit Rangfolge (Spec 2026-09-17, § 5): Was den Publish sperrt,
 * steht vor dem, was ihn nur nahelegt.
 */
const siteTile: DashboardTile<Record<string, never>> = {
  key: 'site',
  permission: 'site.view',
  kind: 'status',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['templateUnreviewed', 'lastFailed', 'changed', 'never', 'current'],
  load(deps): DashboardContent {
    const href = '/site/publish';
    if (templateNeedsReview(deps)) return { kind: 'status', tone: 'warning', messageKey: 'templateUnreviewed', href };
    const last = lastPublish(deps, deps.env);
    if (last && last.status === 'failed') return { kind: 'status', tone: 'warning', messageKey: 'lastFailed', href };
    const success = lastSuccessfulPublish(deps, deps.env);
    if (!success) return { kind: 'status', tone: 'info', messageKey: 'never', href };
    const entries = deps.db.select({ n: count() }).from(siteEntries).where(gt(siteEntries.updatedAt, success.startedAt)).get()?.n ?? 0;
    const values = deps.db.select({ n: count() }).from(siteValues).where(gt(siteValues.updatedAt, success.startedAt)).get()?.n ?? 0;
    const changed = entries + values;
    if (changed > 0) return { kind: 'status', tone: 'info', messageKey: 'changed', values: { count: changed }, href };
    return { kind: 'status', tone: 'neutral', messageKey: 'current', values: { date: success.startedAt }, href };
  },
};

export const SITE_DASHBOARD_TILES: readonly DashboardTile[] = [siteTile as DashboardTile];
