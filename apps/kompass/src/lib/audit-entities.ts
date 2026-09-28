import { resolveRecordLabel, type CallContext, type Deps } from '@kompass/core';

export type AuditEntityLabel = { state: 'ok'; label: string } | { state: 'missing' };

/**
 * Beschriftung der Objekte im Änderungsprotokoll, live aus dem Modul, dem der
 * Datensatz gehört (`recordLabels`). Das Protokoll selbst trägt bei
 * Personendaten nur die ID (Befund 48): Solange der Datensatz existiert, steht
 * hier sein Name; ist er gelöscht, steht da, dass er gelöscht ist. Ohne Haken
 * oder ohne Leserecht bleibt es bei der ID — dann fehlt der Eintrag.
 */
export function auditEntityLabels(
  deps: Deps,
  ctx: CallContext,
  entries: { id: string; entityType: string; entityId: string | null }[],
): Record<string, AuditEntityLabel> {
  const labels: Record<string, AuditEntityLabel> = {};
  for (const entry of entries) {
    if (!entry.entityId) continue;
    const label = resolveRecordLabel(deps, ctx, entry.entityType, entry.entityId);
    if (label?.state === 'ok' && label.label) labels[entry.id] = { state: 'ok', label: label.label };
    else if (label?.state === 'missing') labels[entry.id] = { state: 'missing' };
  }
  return labels;
}
