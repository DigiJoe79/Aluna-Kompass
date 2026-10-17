import type { AuditObject } from './audit-entities';

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
 * der Kanal in Worten, und das Objekt wie in der Ansicht (Befund 5, 0.2.2; Typ in Worten seit 2026-10-09). Die
 * Vorlage druckt nur noch, was sie bekommt. Die Aktion steht als Satz bzw. Klartext (Spec Protokoll § 4).
 */
export function auditExportEntries(
  entries: readonly AuditRow[],
  opts: {
    timeZone: string;
    channels: Record<string, string>;
    /** Das Objekt wie in der Spalte der Ansicht (`auditObject`): Typ in Worten und Name, nie die ID. */
    entity: (e: AuditRow) => AuditObject;
    /** Satz je Eintrag aus `auditSentences` (Papier); `null` oder fehlend → `actionLabel`. */
    sentences: Record<string, string | null>;
    /** Der Klartext der Aktion (`auditActionLabel`). */
    actionLabel: (action: string) => string;
  },
) {
  // Papier, nicht Bildschirm (MUSTER § Datum): Der Export ist ein Prüfdokument und steht fest in TT.MM.JJJJ HH:mm:ss,
  // unabhängig von `ui.dateFormat` — wie `paperDate`, nur mit Uhrzeit und Sekunden zum Abgleich mit Serverprotokollen.
  // Eigenes Intl, weil der Kern dafür keine Funktion hat; steht in der Erlaubnisliste von `no-raw-date` (Teil 5).
  const format = new Intl.DateTimeFormat('de-DE', { timeZone: opts.timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return entries.map((e) => {
    const object = opts.entity(e);
    return {
      occurredAt: format.format(new Date(e.occurredAt)).replace(', ', ' '),
      userName: e.userName,
      channel: opts.channels[e.channel] ?? e.channel,
      entity: object.name ? `${object.word} · ${object.name}` : object.word,
      // „gelöscht“ eigens: Die Vorlage setzt es kursiv, damit es nicht wie ein Name aussieht.
      entityGone: object.deleted,
      sentence: opts.sentences[e.id] ?? opts.actionLabel(e.action),
    };
  });
}
