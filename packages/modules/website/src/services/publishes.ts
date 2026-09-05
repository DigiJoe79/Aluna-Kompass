import { isoNow, newId, ok, recordAudit, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, desc, eq } from 'drizzle-orm';
import { websitePublishes } from '../schema';

export type PublishRecord = typeof websitePublishes.$inferSelect;

export interface PublishDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

export async function listPublishes(deps: Deps, ctx: CallContext, input: { environment: string; limit?: number }): Promise<Result<PublishRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websitePublishes).where(eq(websitePublishes.environment, input.environment)).orderBy(desc(websitePublishes.startedAt)).limit(input.limit ?? 20).all());
}

export function lastSuccessfulPublish(deps: Deps, environment: string): PublishRecord | null {
  return deps.db.select().from(websitePublishes).where(and(eq(websitePublishes.environment, environment), eq(websitePublishes.status, 'success'))).orderBy(desc(websitePublishes.startedAt)).get() ?? null;
}

export function recordPublish(deps: Deps, ctx: CallContext, input: { environment: string; startedAt: string; status: 'success' | 'failed' | 'aborted'; contentHash: string; diff: PublishDiff; fileManifest: Record<string, string>; log: string; summary: string }): PublishRecord {
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(websitePublishes).values({
      id,
      environment: input.environment,
      startedAt: input.startedAt,
      finishedAt: isoNow(deps.clock),
      status: input.status,
      contentHash: input.contentHash,
      pagesChanged: input.diff.changed.length,
      pagesAdded: input.diff.added.length,
      pagesRemoved: input.diff.removed.length,
      summary: input.summary,
      triggeredByUserId: ctx.userId,
      log: input.log.slice(-20_000),
      fileManifest: JSON.stringify(input.fileManifest),
    }).run();
    recordAudit(tx, deps, ctx, {
      action: 'website.publish',
      entityType: 'websitePublish',
      entityId: id,
      after: {
        environment: input.environment,
        status: input.status,
        contentHash: input.contentHash,
        changed: input.diff.changed.length,
        added: input.diff.added.length,
        removed: input.diff.removed.length,
      },
      summary: input.summary,
    });
    return tx.select().from(websitePublishes).where(eq(websitePublishes.id, id)).get()!;
  });
}
