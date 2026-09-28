import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import type { Deps } from '../deps';
import type { LabelText, RecordLabel, RecordLabelInput } from './manifest';
import { enabledManifests } from './service';

/** Nach dem Löschen eines Datensatzes, in derselben Transaktion. Wirft ein Haken, rollt alles zurück. */
export function notifyRecordDeleted(tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string): void {
  for (const manifest of enabledManifests(deps)) manifest.recordDeleted?.(tx, deps, ctx, entityType, id);
}

/**
 * K2: der Text einer Bezeichnung — ein Satz bleibt, wie er ist; ein Schlüssel geht über `deps.labels` in die
 * Sprachdatei. Ohne Übersetzer (Tests, Skripte) stehen Schlüssel und Parameter da, nie ein leerer Text.
 */
export function resolveLabel(deps: Pick<Deps, 'labels'>, label: LabelText): string {
  if (typeof label === 'string') return label;
  const params = label.params ?? {};
  if (deps.labels) return deps.labels(label.key, params);
  const values = Object.values(params);
  return values.length > 0 ? `${label.key} ${values.join(' ')}` : label.key;
}

/** Eine Bezeichnung, wie ein Haken sie liefert, mit aufgelöstem Text. */
export function withResolvedLabel<T extends { label: LabelText }>(deps: Pick<Deps, 'labels'>, item: T): Omit<T, 'label'> & { label: string } {
  return { ...item, label: resolveLabel(deps, item.label) };
}

function resolveRecordLabelInput(deps: Deps, input: RecordLabelInput): RecordLabel {
  const { auditLabel, ...rest } = input;
  return { ...rest, label: resolveLabel(deps, input.label), ...(auditLabel !== undefined ? { auditLabel: resolveLabel(deps, auditLabel) } : {}) };
}

export function resolveRecordLabel(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabel | null {
  for (const manifest of enabledManifests(deps)) {
    const label = manifest.recordLabels?.(deps, ctx, entityType, id);
    if (label) return resolveRecordLabelInput(deps, label);
  }
  return null;
}
