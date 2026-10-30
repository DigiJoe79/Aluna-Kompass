import type { MeetingKind, MeetingView } from '@kompass/module-governance';
import type { STATUS_TONES } from '@/components/status-badge';

export type MeetingBadgeStatus = keyof (typeof STATUS_TONES)['meeting'];

/** Tag als laufende Nummer (UTC), ohne `Date`-Objekt — nur zum Abstand zweier ISO-Tage. */
export const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * Die Marke einer Sitzung in der Liste (N6, Designer Phase 1 D4): festgeschrieben ohne Marke; eine geplante Sitzung
 * wird ab `leadDays` vor dem letzten Tag der Einladung zu „Einladung bis {date}“ (Einstellung
 * `governance.deadlineLeadDays`, Plan U1 Entscheidung 6) und bleibt es, wenn der Tag verstrichen ist.
 */
export function meetingBadge(m: Pick<MeetingView, 'state' | 'heldOn'> & { inviteBy: string | null }, today: string, leadDays: number): { status: MeetingBadgeStatus; date?: string } | null {
  if (m.state === 'signed') return null;
  if (m.state === 'planned' && m.inviteBy && dayNumber(today) >= dayNumber(m.inviteBy) - leadDays) return { status: 'inviteDue', date: m.inviteBy };
  return { status: m.state };
}

/** Schlüssel des Titels einer Sitzung: Versammlungen „{organ} {year}“, Vorstand „{organ} am {date}“. */
export function meetingTitleKey(kind: MeetingKind): string {
  return `governance.meetings.title.${kind}`;
}

/** Der Titel einer Sitzung aus Art, Organ und Tag (Plan U1 Task 4, **Claude**). */
export function meetingTitle(t: (key: string, values: Record<string, string>) => string, date: (iso: string) => string, m: { kind: MeetingKind; heldOn: string }, organName: string): string {
  return t(meetingTitleKey(m.kind).replace(/^governance\./, ''), { organ: organName, year: m.heldOn.slice(0, 4), date: date(m.heldOn) });
}
