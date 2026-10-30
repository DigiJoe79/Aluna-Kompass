import type { AttendanceRow } from '../schema';

/** Wer zu einer Uhrzeit anwesend ist (Spec § 5.4). Gäste zählen nur in `persons`. */
export type PresentAt = { persons: number; members: number; voting: number; organMembers: number; contactIds: string[]; votingContactIds: string[] };
/** Bezugsgröße der Beschlussfähigkeit (`QuorumResult['basis']`, hier ohne Import aus dem Dienst). */
export type QuorumBasis = 'allMembers' | 'votingMembers' | 'organMembers' | 'absolute' | 'none';

/** Läuft die Spanne zur Uhrzeit? Kommen zählt mit, Gehen nicht mehr. */
const covers = (p: { from: string; to: string | null }, at: string) => p.from <= at && (p.to === null || p.to > at);

/**
 * Wer zur Uhrzeit `at` anwesend ist — aus den Zeilen der Anwesenheit, ohne Datenbank: derselbe Code im Dienst
 * (`presentAtInternal`) und im Mitlauf (Plan U1 Task 1). Vom Stimmrecht Ausgeschlossene zählt der Beschluss selbst ab.
 */
export function presentFromRows(rows: readonly Pick<AttendanceRow, 'contactId' | 'guest' | 'role' | 'votingRight' | 'periods'>[], at: string): PresentAt {
  const present = rows.filter((r) => r.periods.some((p) => covers(p, at)));
  const persons = present.filter((r) => !r.guest);
  const voting = persons.filter((r) => r.votingRight);
  const ids = (list: typeof rows) => list.flatMap((r) => (r.contactId ? [r.contactId] : []));
  return {
    persons: present.length,
    members: persons.filter((r) => r.role === 'member').length,
    voting: voting.length,
    organMembers: persons.filter((r) => r.role === 'officeHolder').length,
    contactIds: ids(persons),
    votingContactIds: ids(voting),
  };
}

/** Welche Zahl die Beschlussfähigkeit gegen `required` hält (wie `quorumInternal`). */
export function quorumPresent(present: PresentAt, basis: QuorumBasis, assembly: boolean): number {
  if (basis === 'allMembers') return present.members;
  if (basis === 'votingMembers') return present.voting;
  if (basis === 'organMembers') return present.organMembers;
  return assembly ? present.voting : present.organMembers;
}
