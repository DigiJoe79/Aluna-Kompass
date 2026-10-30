import { ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { governanceDeadlinesInternal, type GovernanceDeadline } from './deadlines/list';
import { noticeDeadlineInternal } from './deadlines/notice';
import { organMembersOnInternal } from './invitation/board';
import { meetingStateOf, type MeetingView } from './meetings';
import { contactNameInternal } from './minutes/compose';
import { allVotingOnInternal } from './quorum';
import { resolveRule, type ResolvedRule } from './rules/resolve';
import type { OrganRules } from './rules/schema';
import { governanceMeetings, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type OfficeRow, type OrganKind, type TermRow } from './schema';
import { statuteRulesOnInternal, statuteValidOnInternal } from './statutes';
import { divergingRoleRowsInternal } from './role-rows';
import { officesDueInternal, termRunsOn, termScheduledEnd } from './term-schedule';

/** Ein Platz eines Amts am Tag: belegt mit einer laufenden Inhaberschaft oder frei. */
export interface SeatRow {
  officeId: string;
  officeName: string;
  /** 1-basiert, in der Reihenfolge des Beginns. */
  seat: number;
  termId: string | null;
  contactId: string | null;
  name: string | null;
  /** Planmäßiges Ende (gespeichert oder aus der Amtszeit). */
  until: string | null;
  /** Bleibt bis zur Neuwahl im Amt (Amt mit `untilSuccessor`, ohne gespeichertes Ende). */
  untilSuccessor: boolean;
  /** Nur Anstehendes (Board 4a): Amtszeit endet binnen sechs Monaten, Platz frei, Person hat ein unvereinbares Amt. */
  mark: { kind: 'termEnding' | 'electionDue' | 'vacant' | 'incompatible'; on: string | null } | null;
}

export interface OverviewOrgan {
  id: string;
  kind: OrganKind;
  name: string;
  /** Zahl der aktiven Ämter. */
  offices: number;
  seats: SeatRow[];
  /** Vorstand: Vertretung aus dem Regelwerk heute; sonst `null`. */
  representation: ResolvedRule<OrganRules['representation']> | null;
  /** Versammlung: alle Stimmberechtigten heute; sonst die Zahl der Amtsinhaber. */
  voting: number;
  /** Tag der jüngsten abgehaltenen Sitzung (beendet oder festgeschrieben). */
  lastMeetingOn: string | null;
}

export interface GovernanceOverview {
  organs: OverviewOrgan[];
  /** Gültiger Stand heute; `since` ist seine Eintragung, ohne sie sein jüngster Beschluss (W-7). */
  statute: { id: string; since: string | null } | null;
  nextMeeting: (Pick<MeetingView, 'id' | 'kind' | 'heldOn' | 'startsAt' | 'place' | 'form' | 'state'> & { organName: string; inviteBy: string | null }) | null;
  deadlines: GovernanceDeadline[];
  vacantSeats: number;
  /** Laufende Kontaktrollen von Vorstand, Kasse, Kassenprüfung ohne Amt in Gremien (G-29, bis G7). */
  rolesDiverge: number;
  /**
   * G7: Regelwerk und Finanzen sind sich nicht einig, ob die Mitgliederversammlung die Jahresrechnung genehmigt —
   * `statuteApproves` sagt, was Gremien meint: Das Regelwerk des gültigen Stands kennt `majorities.accounts` an der
   * MV (`basis: 'rules'`), oder eine MV hat die Jahresrechnung mit festgeschriebenem Beschluss genehmigt
   * (`basis: 'resolution'`, V-4). Nur ein Hinweis: Die Einstellung gehört den Finanzen
   * (`finance.reports.assemblyApprovesAccounts`). Ohne Stand und ohne solchen Beschluss `null`.
   */
  accountsApprovalMismatch: { statuteApproves: boolean; basis: 'rules' | 'resolution' } | null;
}

export const governanceOverviewSchema = z.object({});

/** Die Plätze eines Amts am Tag — belegte nach Beginn, dann die freien. */
export function seatRowsInternal(db: DbOrTx, office: OfficeRow, terms: TermRow[], offices: Map<string, OfficeRow>, ending: Map<string, string | null>, day: string): SeatRow[] {
  const running = terms.filter((t) => t.officeId === office.id && termRunsOn(t, office, day)).sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
  const rows: SeatRow[] = running.map((term, i) => {
    const incompatible = terms.some((other) => {
      if (other.id === term.id || other.contactId !== term.contactId || other.officeId === office.id) return false;
      const otherOffice = offices.get(other.officeId);
      if (!otherOffice || !termRunsOn(other, otherOffice, day)) return false;
      return office.incompatibleWith.includes(otherOffice.id) || otherOffice.incompatibleWith.includes(office.id);
    });
    // Ersatzweise bestellt (ohne Ende): zur Nachwahl fällig statt „endet“ ohne Tag (V-11).
    const endsOn = ending.get(term.id) ?? null;
    const mark: SeatRow['mark'] = incompatible ? { kind: 'incompatible', on: null } : ending.has(term.id) ? (endsOn === null ? { kind: 'electionDue', on: null } : { kind: 'termEnding', on: endsOn }) : null;
    return {
      officeId: office.id,
      officeName: office.name,
      seat: i + 1,
      termId: term.id,
      contactId: term.contactId,
      name: contactNameInternal(db, term.contactId),
      until: termScheduledEnd(term, office),
      untilSuccessor: office.untilSuccessor && term.until === null,
      mark,
    };
  });
  for (let seat = rows.length + 1; seat <= office.seats; seat += 1) {
    rows.push({ officeId: office.id, officeName: office.name, seat, termId: null, contactId: null, name: null, until: null, untilSuccessor: false, mark: { kind: 'vacant', on: null } });
  }
  return rows;
}

/** Die Übersicht der Gremien am Tag `today` — berechnet, nie gespeichert. */
export function governanceOverviewInternal(deps: Deps, today: string): GovernanceOverview {
  const db = deps.db;
  const organs = db.select().from(governanceOrgans).orderBy(asc(governanceOrgans.sortOrder), asc(governanceOrgans.id)).all().filter((o) => o.active);
  const allOffices = db.select().from(governanceOffices).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all();
  const officeById = new Map(allOffices.map((o) => [o.id, o]));
  const terms = db.select().from(governanceTerms).all();
  const ending = new Map(officesDueInternal(db, today).filter((d) => d.reason === 'ending' && d.termId).map((d) => [d.termId!, d.endsOn]));
  const { rules } = statuteRulesOnInternal(db, today);
  const meetings = db.select().from(governanceMeetings).all();
  const out: OverviewOrgan[] = organs.map((organ) => {
    const offices = allOffices.filter((o) => o.organId === organ.id && o.active);
    const held = meetings.filter((m) => m.organId === organ.id && m.heldOn <= today && ['recorded', 'signed'].includes(meetingStateOf(m))).map((m) => m.heldOn).sort();
    return {
      id: organ.id,
      kind: organ.kind,
      name: organ.name,
      offices: offices.length,
      seats: offices.flatMap((o) => seatRowsInternal(db, o, terms, officeById, ending, today)),
      representation: organ.kind === 'board' ? resolveRule(rules, organ.id, 'representation') : null,
      voting: organ.kind === 'assembly' ? allVotingOnInternal(db, deps, organ.id, today) : organMembersOnInternal(db, organ.id, today).length,
      lastMeetingOn: held.at(-1) ?? null,
    };
  });
  const valid = statuteValidOnInternal(db, today);
  const assemblies = db.select().from(governanceOrgans).all().filter((o) => o.kind === 'assembly');
  const rulesApprove = valid ? assemblies.some((o) => valid.rules.organs[o.id]?.majorities?.accounts !== undefined) : null;
  // V-4: Der Normalfall braucht keine eigene Mehrheit — dann zeigt der festgeschriebene Beschluss der MV, was gilt.
  const assemblyApproved =
    assemblies.length > 0 &&
    db
      .select({ id: governanceResolutions.id })
      .from(governanceResolutions)
      .innerJoin(governanceMeetings, eq(governanceMeetings.id, governanceResolutions.meetingId))
      .where(and(eq(governanceResolutions.kind, 'accounts'), eq(governanceResolutions.outcome, 'adopted'), isNotNull(governanceMeetings.sealedAt), inArray(governanceMeetings.organId, assemblies.map((o) => o.id))))
      .get() !== undefined;
  const statuteApproves = rulesApprove === true || assemblyApproved ? true : rulesApprove;
  const approvalBasis: 'rules' | 'resolution' = rulesApprove === true || !assemblyApproved ? 'rules' : 'resolution';
  const financeApproves = readSetting<boolean>(deps, 'finance.reports.assemblyApprovesAccounts') === true;
  const next = meetings
    // W-6: nur, was noch bevorsteht — eine heute schon gehaltene (begonnen, beendet) zählt nicht.
    .filter((m) => m.heldOn >= today && ['planned', 'invited'].includes(meetingStateOf(m)))
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn) || a.startsAt.localeCompare(b.startsAt))[0];
  const organName = new Map(db.select().from(governanceOrgans).all().map((o) => [o.id, o.name]));
  let nextMeeting: GovernanceOverview['nextMeeting'] = null;
  if (next) {
    const deadline = noticeDeadlineInternal(db, next.organId, next.heldOn);
    nextMeeting = {
      id: next.id,
      kind: next.kind,
      heldOn: next.heldOn,
      startsAt: next.startsAt,
      place: next.place,
      form: next.form,
      state: meetingStateOf(next),
      organName: organName.get(next.organId) ?? '',
      inviteBy: deadline.sendBy.post ?? deadline.lastReceiptDay,
    };
  }
  return {
    organs: out,
    // W-7: gültig ab der Eintragung (§ 71 BGB), wie im Kontext der Sitzung; vor der Ersteintragung der jüngste Beschluss.
    statute: valid ? { id: valid.id, since: valid.registeredOn ?? valid.resolutions.map((r) => r.on).sort().at(-1) ?? null } : null,
    nextMeeting,
    deadlines: governanceDeadlinesInternal(deps, today),
    vacantSeats: out.reduce((n, o) => n + o.seats.filter((s) => s.contactId === null).length, 0),
    rolesDiverge: divergingRoleRowsInternal(db, today),
    accountsApprovalMismatch: statuteApproves === null || statuteApproves === financeApproves ? null : { statuteApproves, basis: approvalBasis },
  };
}

/** Übersicht der Gremien: Organe mit Plätzen, gültiger Stand, nächste Sitzung, Fristen. */
export async function getGovernanceOverview(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<GovernanceOverview>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, governanceOverviewSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(governanceOverviewInternal(deps, todayIn(deps)));
}
