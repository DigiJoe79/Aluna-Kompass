import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { FollowUpTarget } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { ok, type Result } from '../result';
import { listDueFollowUps, type FollowUpRecord } from './service';

/**
 * Fragt die eingeschalteten Module; das erste, das antwortet, gewinnt. Ein
 * ausgeschaltetes Modul schweigt — dann steht der Anlass ohne Link da, was
 * richtiger ist als ein Link ins Leere.
 */
export function resolveFollowUpTarget(deps: Deps, entityType: string, id: string): FollowUpTarget | null {
  for (const manifest of enabledManifests(deps)) {
    const target = manifest.followUpTargets?.(deps, entityType, id);
    if (target) return target;
  }
  return null;
}

export type FollowUpWithTarget = FollowUpRecord & { target: FollowUpTarget | null };

export async function listDueFollowUpsWithTargets(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpWithTarget[]>> {
  const due = await listDueFollowUps(deps, ctx, input);
  if (!due.ok) return due;
  return ok(due.value.map((row) => ({ ...row, target: resolveFollowUpTarget(deps, row.entityType, row.entityId) })));
}
