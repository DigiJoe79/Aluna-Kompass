import type { ElectionDetails, ElectionView, MeetingDetail } from '@kompass/module-governance';

export type OpenPoint =
  | { key: string; kind: 'outcomeMissing' | 'reasonMissing'; itemNumber: number }
  | { key: string; kind: 'acceptanceOpen'; itemNumber: number; name: string; contactId: string; resolutionId: string };

/**
 * Was aus dem Mitlauf offen ist (Schritt 4, Board 2c): Beschlüsse ohne Feststellung (Wahlen nicht — dort zählt die
 * Annahme), Feststellungen gegen die Zählung ohne Begründung (`reasonMissing`, Entscheidung 1) und Gewählte ohne
 * Annahme und ohne Ablehnung. Hält das Festschreiben nur dort auf, wo der Dienst es tut.
 */
export function openPoints(detail: Pick<MeetingDetail, 'agenda' | 'resolutions'>, names: Record<string, string>): OpenPoint[] {
  const position = new Map(detail.agenda.map((i) => [i.id, i.position]));
  const out: OpenPoint[] = [];
  for (const r of detail.resolutions) {
    const itemNumber = position.get(r.agendaItemId ?? '') ?? 0;
    if (r.kind === 'election') {
      const details = r.details as ElectionDetails | null;
      const declared = new Set((details?.elected ?? []).map((e) => e.contactId));
      for (const contactId of (r as ElectionView).rounds.at(-1)?.reachedBy ?? []) {
        if (!declared.has(contactId)) out.push({ key: `acceptanceOpen:${r.id}:${contactId}`, kind: 'acceptanceOpen', itemNumber, name: names[contactId] ?? '', contactId, resolutionId: r.id });
      }
      continue;
    }
    if (r.outcome === null) out.push({ key: `outcomeMissing:${r.id}`, kind: 'outcomeMissing', itemNumber });
    else if ((r.warnings as string[]).includes('reasonMissing')) out.push({ key: `reasonMissing:${r.id}`, kind: 'reasonMissing', itemNumber });
  }
  return out;
}
