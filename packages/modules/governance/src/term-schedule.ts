import type { DbOrTx } from '@kompass/core';
import { addCalendarDays, addCalendarMonths } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { governanceOffices, governanceOrgans, governanceTerms, type OfficeRow, type TermRow } from './schema';

/**
 * Planmäßiges Ende einer Amtszeit: das gespeicherte Ende, sonst der Tag vor dem Tag, der dem Beginn nach `termMonths`
 * Monaten entspricht (§ 188 Abs. 2 BGB, Beginn zählt mit); fehlt er im Monat, dessen letzter Tag (§ 188 Abs. 3).
 * `null` ohne Amtszeit. Bei `untilSuccessor` ist das der planmäßige Ablauf — das Amt läuft weiter, die Frist wird
 * trotzdem fällig. Eine Ersatzbestellung läuft bis zur Nachwahl (Spec § 3.3, G-19): ohne planmäßiges Ende.
 */
export function termScheduledEnd(term: Pick<TermRow, 'since' | 'until'> & { origin?: TermRow['origin'] }, office: Pick<OfficeRow, 'termMonths' | 'untilSuccessor'>): string | null {
  if (term.until) return term.until;
  if (term.origin === 'substitute') return null;
  if (office.termMonths === null) return null;
  if (term.since.endsWith('-01')) return addCalendarDays(addCalendarMonths(term.since, office.termMonths), -1);
  return addCalendarMonths(addCalendarDays(term.since, -1), office.termMonths);
}

/** Wirksames Ende: gespeichert, sonst bei einem Amt ohne „bis zur Nachfolge“ das planmäßige. */
const effectiveUntil = (term: TermRow, office: OfficeRow): string | null => term.until ?? (office.untilSuccessor ? null : termScheduledEnd(term, office));
/** Läuft die Amtszeit am Tag (wirksames Ende, siehe oben)? */
export const termRunsOn = (term: TermRow, office: OfficeRow, day: string): boolean => {
  const until = effectiveUntil(term, office);
  return term.since <= day && (until === null || until >= day);
};

export interface OfficeDue {
  officeId: string;
  organId: string;
  reason: 'vacant' | 'ending';
  termId: string | null;
  endsOn: string | null;
}

/**
 * Was zur Wahl ansteht (Spec § 11): ein freier Platz eines aktiven Amts am Tag `day` und jede laufende Amtszeit, deren
 * planmäßiges Ende spätestens `withinMonths` Monate nach `day` liegt — auch eine schon abgelaufene, die bis zur
 * Nachfolge weiterläuft.
 */
export function officesDueInternal(db: DbOrTx, day: string, withinMonths = 6): OfficeDue[] {
  const horizon = addCalendarMonths(day, withinMonths);
  const offices = db.select().from(governanceOffices).where(eq(governanceOffices.active, true)).all();
  const terms = db.select().from(governanceTerms).all();
  return offices.flatMap((office): OfficeDue[] => {
    const running = terms.filter((t) => t.officeId === office.id && termRunsOn(t, office, day));
    const due: OfficeDue[] = running.length < office.seats ? [{ officeId: office.id, organId: office.organId, reason: 'vacant', termId: null, endsOn: null }] : [];
    for (const term of running) {
      const end = termScheduledEnd(term, office);
      if (end !== null && end <= horizon) due.push({ officeId: office.id, organId: office.organId, reason: 'ending', termId: term.id, endsOn: end });
      // Ersatzweise bestellt: zur nächsten Wahl fällig, ohne Tag.
      else if (end === null && term.origin === 'substitute') due.push({ officeId: office.id, organId: office.organId, reason: 'ending', termId: term.id, endsOn: null });
    }
    return due;
  });
}

/**
 * Vorstand führungslos (Spec § 3.3): Kein vertretendes Amt des Vorstands ist am Tag besetzt, nachdem dort schon einmal
 * jemand im Amt war — etwa weil eine Amtszeit ohne „bis zur Nachfolge“ abgelaufen ist.
 */
export function boardLeaderlessInternal(db: DbOrTx, day: string): boolean {
  const board = db.select().from(governanceOrgans).where(eq(governanceOrgans.kind, 'board')).get();
  if (!board) return false;
  const offices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, board.id)).all().filter((o) => o.representative);
  const byId = new Map(offices.map((o) => [o.id, o]));
  const terms = db.select().from(governanceTerms).all().filter((t) => byId.has(t.officeId) && t.since <= day);
  return terms.length > 0 && !terms.some((t) => termRunsOn(t, byId.get(t.officeId)!, day));
}
