import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { FollowUpTarget } from '../modules/manifest';
import { resolveRecordLabel } from '../modules/record-hooks';
import { enabledManifests } from '../modules/service';
import { ok, type Result } from '../result';
import { listDueFollowUps, type FollowUpRecord } from './service';

/** Rückfall für Module ohne `recordLabels`: ohne `ctx`, also ohne Rechteprüfung. */
export function resolveFollowUpTarget(deps: Deps, entityType: string, id: string): FollowUpTarget | null {
  for (const manifest of enabledManifests(deps)) {
    const target = manifest.followUpTargets?.(deps, entityType, id);
    if (target) return target;
  }
  return null;
}

export type FollowUpWithTarget = FollowUpRecord & { target: FollowUpTarget | null };

/**
 * Der Titel einer Wiedervorlage ist frei getippt und gehört zum Datensatz, an
 * dem sie hängt: Wer den nicht lesen darf, sieht auch den Titel nicht.
 */
export function withTarget(deps: Deps, ctx: CallContext, row: FollowUpRecord): FollowUpWithTarget {
  const label = resolveRecordLabel(deps, ctx, row.entityType, row.entityId);
  if (!label) return { ...row, target: resolveFollowUpTarget(deps, row.entityType, row.entityId) };
  if (label.state === 'missing') return { ...row, target: null };
  const target = { label: label.label, href: label.href };
  return label.state === 'forbidden' ? { ...row, title: '', titleHidden: true, target } : { ...row, target };
}

export async function listDueFollowUpsWithTargets(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpWithTarget[]>> {
  const due = await listDueFollowUps(deps, ctx, input);
  if (!due.ok) return due;
  return ok(due.value.map((row) => withTarget(deps, ctx, row)));
}
