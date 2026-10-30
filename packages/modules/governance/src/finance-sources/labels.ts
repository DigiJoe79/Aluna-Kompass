import { resolveLabel, systemContext, type CallContext, type Deps } from '@kompass/core';
import { governanceRecordLabels } from '../record-labels';

/** Lesen darf die Quelle selbst: Die Finanzen zeigen nur Nummer bzw. Organ und Tag, nie Inhalt eines Beschlusses. */
const reader = (): CallContext => ({ ...systemContext(), permissions: new Set(['governance.read']) });

/** Die Beschriftung eines Datensatzes von Gremien als Text, wie Akte und Protokoll sie zeigen (`recordLabels`). */
export function governanceLabelText(deps: Deps, entityType: string, id: string): string | null {
  const label = governanceRecordLabels(deps, reader(), entityType, id);
  return label && label.state === 'ok' ? resolveLabel(deps, label.label) : null;
}
