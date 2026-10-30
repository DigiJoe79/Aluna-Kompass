import type { DbOrTx, Deps } from '@kompass/core';
import { userIdForContactInternal } from '@kompass/module-contacts';
import { addCalendarDays } from '@kompass/module-finance';
import { memberMemberships } from '@kompass/module-members';
import { eq } from 'drizzle-orm';
import { electionViewInternal, winnerDeclarations } from '../elections';
import { followUpTitle } from '../follow-up-titles';
import { formatResolutionNumber } from '../numbers';
import type { ElectionDetails } from '../resolution-details';
import type { ResolutionKind } from '../rules/schema';
import { governanceAttendance, governanceOffices, governanceResolutionCounters, governanceStatutes, governanceTerms, type OfficeRow, type ResolutionOutcome, type ResolutionRow, type TermRow } from '../schema';
import { termRunsOn, termScheduledEnd } from '../term-schedule';
import { rolesForFunction } from '../term-roles';

export const CONSEQUENCE_KINDS = ['numberResolution', 'startTerm', 'linkTerm', 'endPredecessor', 'endTerm', 'statuteResolved', 'registerOccasion', 'followUp', 'financeReference', 'memberProposal', 'none'] as const;
export type ConsequenceKind = (typeof CONSEQUENCE_KINDS)[number];
/** Eine Folge des Festschreibens (Spec § 6). `params` trägt alles, was das Festschreiben zum Wirken braucht. */
export type Consequence = { kind: ConsequenceKind; resolutionId: string | null; params: Record<string, string | number | boolean | null> };
/** `meetingInFuture`: der Sitzungstag liegt nach heute — erst danach lässt sich festschreiben (W-10). */
/** `statuteResolutionInvalid`: ein angenommener Satzungs- oder Zweckbeschluss nennt einen eingetragenen Stand oder stammt nicht von der MV (L-3). */
export type SealBlocker = 'statuteResolutionInvalid' | 'minutesMissing' | 'outcomeMissing' | 'reasonMissing' | 'officeFull' | 'meetingSealed' | 'meetingInFuture';

/** Was die Planung von einem Beschluss braucht — ein gespeicherter Beschluss oder ein Umlauf vor dem Festschreiben. */
export type ResolutionLike = Pick<ResolutionRow, 'kind' | 'details' | 'organId' | 'decidedOn' | 'outcome' | 'meetingId' | 'votedAt' | 'agendaItemId'> & { id: string | null; number?: string | null };

/**
 * Arten, die Finanzen und Mitglieder mit G7 lesen (`effect: 'read'`); die angenommene Vergütung schreiben sie in den
 * Einrichtungspunkt der Finanzen (`effect: 'write'`, `seal/finance.ts`). Die Regel für Aufwendungsersatz bleibt ein
 * Beschluss in Gremien — die Finanzen werten sie nicht aus (Joe 29.10.), deshalb keine Folge.
 */
const FINANCE_KINDS: readonly ResolutionKind[] = ['discharge', 'accounts', 'remuneration', 'reserve', 'feeSchedule'];
const FINANCE_WRITES: readonly ResolutionKind[] = ['remuneration'];
const NO_CONSEQUENCE: readonly ResolutionKind[] = ['minutesApproval', 'agenda', 'simple', 'expenseRule'];

const covers = (t: Pick<TermRow, 'since' | 'until'>, day: string) => t.since <= day && (t.until === null || t.until >= day);

/**
 * Der Stand der Inhaberschaften, an dem die Planung die Folgen nacheinander durchspielt — damit zwei Wahlen in
 * derselben Sitzung (oder eine Wahl nach einer Abberufung) einander sehen und ein überzähliger Platz auffällt.
 */
export class TermSimulation {
  readonly terms: (Pick<TermRow, 'id' | 'officeId' | 'contactId' | 'since' | 'until' | 'resolutionId'> & { origin?: TermRow['origin']; touched: boolean })[];
  readonly offices: Map<string, OfficeRow>;
  officeFull = false;
  /** Plätze des Amts, das überzählig würde — für den Fehler `officeFull`. */
  fullSeats: number | null = null;
  private next = 0;
  constructor(db: DbOrTx) {
    this.terms = db.select().from(governanceTerms).all().map((t) => ({ id: t.id, officeId: t.officeId, contactId: t.contactId, since: t.since, until: t.until, resolutionId: t.resolutionId, origin: t.origin, touched: false }));
    this.offices = new Map(db.select().from(governanceOffices).all().map((o) => [o.id, o]));
  }
  add(officeId: string, contactId: string, since: string, resolutionId: string | null): string {
    const ref = `new:${(this.next += 1)}`;
    this.terms.push({ id: ref, officeId, contactId, since, until: null, resolutionId, touched: true });
    return ref;
  }
}

/** Die Nummern, die das Festschreiben vergeben wird: der Zähler des Jahres weitergezählt (vereinsweit, lückenlos). */
export function numberPredictor(db: DbOrTx): (decidedOn: string) => string {
  const used = new Map<number, number>();
  return (decidedOn) => {
    const year = Number(decidedOn.slice(0, 4));
    const current = used.get(year) ?? db.select().from(governanceResolutionCounters).where(eq(governanceResolutionCounters.year, year)).get()?.next ?? 1;
    used.set(year, current + 1);
    return formatResolutionNumber(year, current);
  };
}

/**
 * Das wirksame Ergebnis: das festgestellte; eine Wahl ohne Feststellung gilt als angenommen, sobald jemand die Wahl
 * angenommen oder im letzten Gang die Mehrheit erreicht hat (die Leitung stellt Wahlen über die Gänge fest).
 */
export function effectiveOutcome(db: DbOrTx, deps: Deps, row: ResolutionLike): ResolutionOutcome | null {
  if (row.outcome) return row.outcome;
  if (row.kind !== 'election' || !row.id || !row.meetingId) return null;
  return electionViewInternal(db, deps, row as ResolutionRow).winners.length > 0 ? 'adopted' : null;
}

/** Das Benutzerkonto, dem der Auftrag zufällt: Inhaber des Amts, beim Organ dessen Vorsitz — am Beschlusstag. */
function recipientUser(db: DbOrTx, details: { organId: string | null; officeId: string | null }, day: string): string | null {
  const office: OfficeRow | undefined = details.officeId
    ? db.select().from(governanceOffices).where(eq(governanceOffices.id, details.officeId)).get()
    : details.organId
      ? db.select().from(governanceOffices).where(eq(governanceOffices.organId, details.organId)).all().find((o) => o.function === 'chair')
      : undefined;
  if (!office) return null;
  const holder = db.select().from(governanceTerms).where(eq(governanceTerms.officeId, office.id)).all().find((t) => termRunsOn(t, office, day));
  return holder ? userIdForContactInternal(db, holder.contactId) : null;
}

function electionConsequences(row: ResolutionLike, sim: TermSimulation, founding: boolean, winners: readonly string[]): Consequence[] {
  const details = row.details as ElectionDetails;
  const office = sim.offices.get(details.officeId);
  if (!office) return [];
  const resolutionId = row.id;
  const out: Consequence[] = [];
  // K-1: Amtszeiten nur für Gewählte mit Annahme — die Erklärung einer Unterlegenen plant nichts.
  const declarations = winnerDeclarations(details, winners);
  const accepted = declarations.filter((e) => e.acceptedOn && !e.declinedOn).sort((a, b) => a.acceptedOn!.localeCompare(b.acceptedOn!));
  // G-2: Gewählt, aber noch ohne Erklärung, behält ihren Platz — sie macht keinem Neuen Platz, bis sie annimmt oder ablehnt.
  const declined = new Set(declarations.filter((e) => e.declinedOn).map((e) => e.contactId));
  const reelected = new Set([...accepted.map((e) => e.contactId), ...winners.filter((c) => !declined.has(c))]);
  for (const e of accepted) {
    const on = e.acceptedOn!;
    const own = sim.terms.find((t) => t.officeId === office.id && t.contactId === e.contactId && covers(t, on));
    if (own && resolutionId && own.resolutionId === resolutionId) continue;
    const scheduled = own ? termScheduledEnd(own, office) : null;
    // Review Focus 1: Die Inhaberschaft gibt es schon (nachgetragen aus einer Rollenzeile) und sie läuft planmäßig noch.
    // Eine Ersatzbestellung wird nicht verknüpft: Mit der Wahl endet sie, und eine reguläre Amtszeit beginnt (G-19).
    if (own && own.resolutionId === null && own.origin !== 'substitute' && (scheduled === null || scheduled >= on || own.since >= on)) {
      own.resolutionId = resolutionId;
      own.touched = true;
      out.push({ kind: 'linkTerm', resolutionId, params: { termId: own.id, officeId: office.id, contactId: e.contactId, acceptedOn: on } });
      continue;
    }
    const previous = addCalendarDays(on, -1);
    // Review Focus 2: Wiederwahl derselben Person — die alte endet am Vortag, die neue beginnt mit der Annahme.
    if (own && own.since < on) {
      own.until = previous;
      own.touched = true;
      out.push({ kind: 'endPredecessor', resolutionId, params: { termId: own.id, officeId: office.id, contactId: own.contactId, until: previous, reason: 'successor' } });
    }
    let occupied = sim.terms.filter((t) => t.officeId === office.id && covers(t, on)).length;
    // Spec § 6: Ist das Amt voll, endet eine laufende Inhaberschaft am Vortag — auch wenn ihre Amtszeit planmäßig noch
    // läuft (Neuwahl vor Ablauf). Nicht aus diesem Beschluss, nicht wiedergewählt; zuerst das früheste planmäßige Ende,
    // dann der früheste Beginn, unbefristete zuletzt.
    while (occupied + 1 > office.seats) {
      const endable = sim.terms
        .filter((t) => t.officeId === office.id && covers(t, on) && !t.touched && t.since < on && (resolutionId === null || t.resolutionId !== resolutionId) && !reelected.has(t.contactId))
        .map((t) => ({ t, end: termScheduledEnd(t, office) }))
        .sort((a, b) => (a.end === null ? 1 : 0) - (b.end === null ? 1 : 0) || (a.end ?? '').localeCompare(b.end ?? '') || a.t.since.localeCompare(b.t.since))[0];
      if (!endable) {
        sim.officeFull = true;
        sim.fullSeats = office.seats;
        break;
      }
      endable.t.until = previous;
      endable.t.touched = true;
      out.push({ kind: 'endPredecessor', resolutionId, params: { termId: endable.t.id, officeId: office.id, contactId: endable.t.contactId, until: previous, reason: 'successor' } });
      occupied -= 1;
    }
    const ref = sim.add(office.id, e.contactId, on, resolutionId);
    out.push({ kind: 'startTerm', resolutionId, params: { ref, officeId: office.id, contactId: e.contactId, since: on, acceptedOn: on, roles: rolesForFunction(office.function).join(', ') } });
    // § 67 BGB: jede Änderung des Vorstands, nicht die Wiederwahl derselben Person; die Gründung meldet `initial`.
    if (office.representative && !own && !founding) out.push({ kind: 'registerOccasion', resolutionId, params: { kind: 'boardChange', occurredOn: on, officeId: office.id, termRef: ref, statuteId: null } });
  }
  return out;
}

/**
 * Die Folgen eines Beschlusses (Spec § 6) — nur `adopted` wirkt; die Nummer plant der Aufrufer. Die Simulation hält
 * den Stand der Ämter über alle Beschlüsse derselben Sitzung. `locale`: Leitsprache für den Titel einer Wiedervorlage.
 */
export function resolutionConsequencesInternal(db: DbOrTx, row: ResolutionLike, number: string | null, sim: TermSimulation, founding: boolean, locale: string, electionWinners: readonly string[] = []): Consequence[] {
  const resolutionId = row.id;
  const d = (row.details ?? {}) as Record<string, unknown>;
  const occasionOf = (kind: string, extra: Record<string, string | null> = {}): Consequence => ({ kind: 'registerOccasion', resolutionId, params: { kind, occurredOn: row.decidedOn, officeId: null, termRef: null, statuteId: null, ...extra } });
  switch (row.kind) {
    case 'election':
      return electionConsequences(row, sim, founding, electionWinners);
    case 'dismissal': {
      const term = sim.terms.find((t) => t.id === d.termId);
      if (!term || (term.until !== null && term.until <= row.decidedOn)) return [{ kind: 'none', resolutionId, params: { kind: row.kind } }];
      term.until = row.decidedOn;
      term.touched = true;
      const out: Consequence[] = [{ kind: 'endTerm', resolutionId, params: { termId: term.id, officeId: term.officeId, contactId: term.contactId, until: row.decidedOn, reason: 'dismissed' } }];
      if (sim.offices.get(term.officeId)?.representative && !founding) out.push(occasionOf('boardChange', { officeId: term.officeId, termRef: term.id }));
      return out;
    }
    case 'statute':
    case 'purpose': {
      const statuteId = typeof d.statuteId === 'string' ? d.statuteId : null;
      if (!statuteId) return [{ kind: 'none', resolutionId, params: { kind: row.kind } }];
      const purpose = row.kind === 'purpose';
      // G-31: Die Antwort des Stands (berührt die Gemeinnützigkeit), offen `null`; eine Zweckänderung immer `true`.
      const answered = db.select().from(governanceStatutes).where(eq(governanceStatutes.id, statuteId)).get()?.taxReview.affectsCharity ?? null;
      const affectsCharity = purpose ? true : answered;
      const out: Consequence[] = [{ kind: 'statuteResolved', resolutionId, params: { statuteId, on: row.decidedOn, affectsCharity, hint: purpose ? 'purposeFundsBound' : null } }];
      if (!founding) out.push(occasionOf('statute', { statuteId }));
      return out;
    }
    case 'dissolution':
      // Kein Satzungsstand (Steuerprüfung M2); Frist § 137 AO und Hinweise führt G5.
      return [occasionOf('dissolution')];
    case 'mandate': {
      // Ohne Angaben keine Frist, also keine Wiedervorlage; `hint` sagt es in der Vorschau.
      if (!d.dueOn) return [{ kind: 'none', resolutionId, params: { kind: row.kind, hint: 'noDeadline' } }];
      const assigneeUserId = recipientUser(db, { organId: (d.organId as string | null) ?? null, officeId: (d.officeId as string | null) ?? null }, row.decidedOn);
      // W-12: Der Titel steht im Protokoll — nur die Nummer, kein Freitext; ohne Benutzerkonto beim Amt oder Organ sagt
      // `hint` es vorab.
      return [{ kind: 'followUp', resolutionId, params: { dueAt: String(d.dueOn), title: followUpTitle(locale, 'mandate', { number: number ?? '' }), assigneeUserId, ...(assigneeUserId ? {} : { hint: 'noAssignee' }) } }];
    }
    case 'exclusion': {
      const membership = typeof d.membershipId === 'string' ? db.select().from(memberMemberships).where(eq(memberMemberships.id, d.membershipId)).get() : undefined;
      return [{ kind: 'memberProposal', resolutionId, params: { proposal: 'endMembership', membershipId: membership?.id ?? null, contactId: membership?.contactId ?? null, on: row.decidedOn, typeId: null } }];
    }
    case 'honoraryMember': {
      const membership = typeof d.membershipId === 'string' ? db.select().from(memberMemberships).where(eq(memberMemberships.id, d.membershipId)).get() : undefined;
      return [{ kind: 'memberProposal', resolutionId, params: { proposal: 'changeType', membershipId: membership?.id ?? null, contactId: membership?.contactId ?? null, on: row.decidedOn, typeId: (d.typeId as string) ?? null } }];
    }
    default:
      if (FINANCE_KINDS.includes(row.kind)) return [{ kind: 'financeReference', resolutionId, params: { kind: row.kind, effect: FINANCE_WRITES.includes(row.kind) ? 'write' : 'read' } }];
      if (NO_CONSEQUENCE.includes(row.kind)) return [{ kind: 'none', resolutionId, params: { kind: row.kind } }];
      return [];
  }
}

/** Gründer (Spec § 5.7): ohne Mitgliedschaft zum Gründungstag der Vorschlag, sie anzulegen; mit ihr nur der Abgleich. */
export function foundingConsequencesInternal(db: DbOrTx, meetingId: string, heldOn: string): Consequence[] {
  const founders = db.select().from(governanceAttendance).where(eq(governanceAttendance.meetingId, meetingId)).all().filter((r) => r.role === 'founder' && r.contactId);
  const out: Consequence[] = founders.map((r): Consequence => {
    const has = founderHasMembershipInternal(db, r.contactId!, heldOn);
    return has ? { kind: 'none', resolutionId: null, params: { kind: 'founderHasMembership', contactId: r.contactId } } : { kind: 'memberProposal', resolutionId: null, params: { proposal: 'createMembership', membershipId: null, contactId: r.contactId, on: heldOn, typeId: null } };
  });
  out.push({ kind: 'registerOccasion', resolutionId: null, params: { kind: 'initial', occurredOn: heldOn, officeId: null, termRef: null, statuteId: null } });
  return out;
}

export function founderHasMembershipInternal(db: DbOrTx, contactId: string, heldOn: string): boolean {
  return db
    .select()
    .from(memberMemberships)
    .where(eq(memberMemberships.contactId, contactId))
    .all()
    .some((m) => m.joinedOn !== null && m.joinedOn <= heldOn);
}
