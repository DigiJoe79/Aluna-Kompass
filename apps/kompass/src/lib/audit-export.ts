import type { AuditEntityLabel } from './audit-entities';

interface AuditRow {
  id: string;
  occurredAt: string;
  userName: string | null;
  channel: string;
  action: string;
  entityType: string;
  entityId: string | null;
}

/**
 * Die Zeilen des PDF-Auszugs, so lesbar wie die Ansicht: Zeit in der Zeitzone des Vereins statt ISO in UTC,
 * der Kanal in Worten, und der Name des Datensatzes, wo die Ansicht ihn auch zeigt (Befund 5, 0.2.2). Die
 * Vorlage druckt nur noch, was sie bekommt. Die Aktion steht als Satz bzw. Klartext (Spec Protokoll § 4).
 */
export function auditExportEntries(
  entries: readonly AuditRow[],
  opts: {
    timeZone: string;
    channels: Record<string, string>;
    labels: Record<string, AuditEntityLabel>;
    deleted: (entityType: string) => string;
    /** Satz je Eintrag aus `auditSentences` (Papier); `null` oder fehlend → `actionLabel`. */
    sentences: Record<string, string | null>;
    /** Der Klartext der Aktion (`auditActionLabel`). */
    actionLabel: (action: string) => string;
  },
) {
  const format = new Intl.DateTimeFormat('de-DE', { timeZone: opts.timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return entries.map((e) => {
    const label = opts.labels[e.id];
    return {
      occurredAt: format.format(new Date(e.occurredAt)).replace(', ', ' '),
      userName: e.userName,
      channel: opts.channels[e.channel] ?? e.channel,
      entityType: e.entityType,
      entityId: e.entityId,
      entityLabel: label?.state === 'ok' ? label.label : label?.state === 'missing' ? opts.deleted(e.entityType) : null,
      sentence: opts.sentences[e.id] ?? opts.actionLabel(e.action),
    };
  });
}
