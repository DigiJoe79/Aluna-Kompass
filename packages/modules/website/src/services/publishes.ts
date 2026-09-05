import { ok, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { desc, eq } from 'drizzle-orm';
import { websitePublishes } from '../schema';

export type PublishRecord = typeof websitePublishes.$inferSelect;

export async function listPublishes(deps: Deps, ctx: CallContext, input: { environment: string; limit?: number }): Promise<Result<PublishRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websitePublishes).where(eq(websitePublishes.environment, input.environment)).orderBy(desc(websitePublishes.startedAt)).limit(input.limit ?? 20).all());
}
