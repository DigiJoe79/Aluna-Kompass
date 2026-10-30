import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { presentAtInternal } from './attendance';
import { catchAborted, governanceConflict } from './errors';
import { minutesVersionsInternal } from './minutes/signed';
import { applyLateAcceptanceInternal } from './seal/seal';
import { evaluateMajority } from './majority';
import { meetingRowInternal, meetingStateOf } from './meetings';
import { allVotingOnInternal } from './quorum';
import { electionRoundSchema, type ElectionDetails } from './resolution-details';
import { resolutionViewInternal, type ResolutionView, type ResolutionWarning } from './resolutions';
import { LAW_FALLBACK } from './rules/law';
import { resolveRule } from './rules/resolve';
import { governanceAgendaItems, governanceOffices, governanceResolutions, governanceTerms, type MeetingRow, type OfficeRow, type ResolutionRow } from './schema';
import { requireWriterInternal } from './session';
import { resolutionRulesInternal } from './statutes';
import { termRunsOn } from './term-schedule';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DAY = z.iso.date();
const id = z.string().min(1);

export type ElectionRound = ElectionDetails['rounds'][number];
export type ElectionWarning = 'incompatible' | 'seatsExceeded';
/**
 * Je Wahlgang, wer die Mehrheit erreicht hat (bei mehreren Plätzen die Besten bis zur Zahl der noch offenen Plätze —
 * wer in einem früheren Gang gewählt ist, belegt seinen Platz); `winners` alle Gewählten über die Gänge (G-1, G-2).
 */
export type ElectionView = Omit<ResolutionView, 'warnings'> & {
  rounds: { number: number; reachedBy: string[]; needed: number }[];
  winners: string[];
  runoffSuggested: { contactIds: [string, string] } | null;
  warnings: (ResolutionWarning | ElectionWarning)[];
};

export const electionRoundSaveSchema = z.object({ agendaItemId: id, officeId: id, votedAt: TIME, round: electionRoundSchema });
export const electionAcceptSchema = z.object({
  resolutionId: id,
  contactId: id,
  /** Vorgabe: Sitzungstag; Abwesende nehmen später an. */
  acceptedOn: DAY.optional(),
  declined: z.boolean().optional(),
});

/**
 * Auswertung eines Wahlgangs für die noch offenen `seats` (G-1): je Kandidat Ja = seine Stimmen. Bei einem offenen
 * Platz zählen die Stimmen der anderen dagegen; bei mehreren zählt jeder Stimmzettel ohne diesen Kandidaten dagegen
 * (anwesende Stimmberechtigte ohne Enthaltung und ungültige — wer anwesend ist, gilt als abstimmend).
 */
function evaluateRound(db: DbOrTx, deps: Deps, row: ResolutionRow, seats: number, round: ElectionRound, index: number) {
  const { rules } = resolutionRulesInternal(db, row);
  const election = resolveRule(rules, row.organId, 'election').value ?? LAW_FALLBACK.election.value!;
  const majority = election.rounds[index] ?? election.rounds.at(-1)!;
  const presentVoting = presentAtInternal(db, row.meetingId!, row.votedAt!).voting;
  const allVoting = allVotingOnInternal(db, deps, row.organId, row.decidedOn);
  if (round.unanimousContactId) return { number: round.number, reachedBy: seats > 0 ? [round.unanimousContactId] : [], needed: 0, strongest: [round.unanimousContactId] };
  const total = round.candidates.reduce((sum, c) => sum + c.votes, 0);
  const ballots = Math.max(presentVoting - round.abstain - round.invalid, round.no + Math.max(0, ...round.candidates.map((c) => c.votes)));
  let needed = 0;
  const reached = round.candidates
    .map((c) => {
      const no = seats <= 1 ? round.no + total - c.votes : Math.max(round.no, ballots - c.votes);
      const result = evaluateMajority({ majority, votes: { yes: c.votes, no, abstain: round.abstain, invalid: round.invalid }, presentVoting, allVoting, excluded: 0, tie: 'rejected' });
      needed = Math.max(needed, result.needed);
      return { ...c, reached: result.reached === true };
    })
    .sort((a, b) => b.votes - a.votes);
  return { number: round.number, reachedBy: reached.filter((c) => c.reached).slice(0, Math.max(0, seats)).map((c) => c.contactId), needed, strongest: reached.map((c) => c.contactId) };
}

/** Hat die Person am Tag ein Amt inne, das mit `office` nicht zusammengehen soll (in beide Richtungen)? */
function incompatible(db: DbOrTx, office: OfficeRow, contactId: string, day: string): boolean {
  const offices = db.select().from(governanceOffices).all();
  const clash = new Set([...office.incompatibleWith, ...offices.filter((o) => o.incompatibleWith.includes(office.id)).map((o) => o.id)]);
  const byId = new Map(offices.map((o) => [o.id, o]));
  return db
    .select()
    .from(governanceTerms)
    .where(eq(governanceTerms.contactId, contactId))
    .all()
    .some((t) => clash.has(t.officeId) && termRunsOn(t, byId.get(t.officeId)!, day));
}

/** K-1: Annahme und Ablehnung zählen nur von Gewählten — eine gespeicherte Erklärung einer Unterlegenen bleibt ohne Wirkung. */
export const winnerDeclarations = (details: ElectionDetails, winners: readonly string[]): ElectionDetails['elected'] => details.elected.filter((e) => winners.includes(e.contactId));

export function electionViewInternal(db: DbOrTx, deps: Deps, row: ResolutionRow): ElectionView {
  const details = row.details as ElectionDetails;
  const office = db.select().from(governanceOffices).where(eq(governanceOffices.id, details.officeId)).get()!;
  const reachedBefore: string[] = [];
  const evaluated = details.rounds.map((r, i) => {
    const result = evaluateRound(db, deps, row, office.seats - reachedBefore.length, r, i);
    reachedBefore.push(...result.reachedBy.filter((c) => !reachedBefore.includes(c)));
    return result;
  });
  const { rules } = resolutionRulesInternal(db, row);
  const rule = resolveRule(rules, row.organId, 'election').value ?? LAW_FALLBACK.election.value!;
  const last = evaluated.at(-1);
  const lastRound = details.rounds.at(-1);
  // K-4: Auch wenn der letzte Gang einen Platz besetzt hat — bleibt einer offen, gehen die zwei Stärksten der Übrigen in die Stichwahl.
  const runoffSuggested =
    rule.runoff && last && lastRound && !lastRound.runoff && last.number >= rule.rounds.length && reachedBefore.length < office.seats && last.strongest.filter((c) => !reachedBefore.includes(c)).length >= 2
      ? { contactIds: last.strongest.filter((c) => !reachedBefore.includes(c)).slice(0, 2) as [string, string] }
      : null;
  const winners = [...reachedBefore];
  const accepted = winnerDeclarations(details, winners).filter((e) => e.acceptedOn !== null && e.declinedOn === null).map((e) => e.contactId);
  const concerned = [...new Set([...winners, ...accepted])];
  const base = resolutionViewInternal(db, deps, row);
  const warnings: ElectionView['warnings'] = [...base.warnings];
  const day = meetingRowInternal(db, row.meetingId!)?.heldOn ?? row.decidedOn;
  if (concerned.some((c) => incompatible(db, office, c, day))) warnings.push('incompatible');
  if (accepted.length > office.seats) warnings.push('seatsExceeded');
  return { ...base, rounds: evaluated.map(({ strongest: _s, ...r }) => r), winners, runoffSuggested, warnings };
}

function loadForWrite(deps: Deps, ctx: CallContext, meeting: MeetingRow, allowRecorded: boolean) {
  // Annahme Abwesender nach dem Ende der Sitzung — auch nach dem Festschreiben (dann wirkt sie sofort, Plan G4 Task 6).
  if (allowRecorded && (meetingStateOf(meeting) === 'recorded' || meetingStateOf(meeting) === 'signed')) return null;
  return requireWriterInternal(deps.db, ctx, meeting);
}

/**
 * Erfasst einen Wahlgang für ein Amt (Spec § 5.4); der Beschluss `election` je TOP und Amt entsteht beim ersten Gang.
 * Ein Gang mit derselben Nummer wird ersetzt. Kein Stimmverbot bei Wahlen.
 */
export async function saveElectionRound(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ElectionView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, electionRoundSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { agendaItemId, officeId, votedAt, round } = parsed.value;
  const item = deps.db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, agendaItemId)).get();
  if (!item) return notFound('governanceAgendaItem', agendaItemId);
  const meeting = meetingRowInternal(deps.db, item.meetingId)!;
  const refused = loadForWrite(deps, ctx, meeting, false);
  if (refused) return refused;
  if (item.kind !== 'election') return invalid([{ path: 'agendaItemId', message: 'notElection' }]);
  if (item.officeIds.length > 0 && !item.officeIds.includes(officeId)) return invalid([{ path: 'officeId', message: 'notOnAgenda' }]);
  const office = deps.db.select().from(governanceOffices).where(eq(governanceOffices.id, officeId)).get();
  if (!office) return notFound('governanceOffice', officeId);
  const present = presentAtInternal(deps.db, meeting.id, votedAt).voting;
  const total = round.candidates.reduce((sum, c) => sum + c.votes, 0);
  const ballots = (office.seats === 1 ? total : Math.max(0, ...round.candidates.map((c) => c.votes))) + round.no + round.abstain + round.invalid;
  if (!round.unanimousContactId && ballots > present) return invalid([{ path: 'round', message: 'votesExceedVoters' }]);
  const before = deps.db
    .select()
    .from(governanceResolutions)
    .where(and(eq(governanceResolutions.agendaItemId, item.id), eq(governanceResolutions.kind, 'election')))
    .all()
    .find((r) => (r.details as ElectionDetails).officeId === officeId);
  const previous = (before?.details as ElectionDetails | undefined) ?? { officeId, rounds: [], elected: [] };
  const details: ElectionDetails = { ...previous, rounds: [...previous.rounds.filter((r) => r.number !== round.number), round].sort((a, b) => a.number - b.number) };
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const rowId = before?.id ?? newId();
    if (before) tx.update(governanceResolutions).set({ details, votedAt, updatedAt: now }).where(eq(governanceResolutions.id, rowId)).run();
    else
      tx.insert(governanceResolutions)
        .values({ id: rowId, meetingId: meeting.id, circularId: null, agendaItemId: item.id, organId: meeting.organId, kind: 'election', text: item.proposal ?? item.title, votedAt, decidedOn: meeting.heldOn, votes: null, yesComputed: false, unanimous: round.unanimousContactId !== null, excluded: [], outcome: null, outcomeReason: null, details, number: null, createdAt: now, updatedAt: now })
        .run();
    recordAudit(tx, deps, ctx, { action: 'governance.election.round', entityType: 'governanceResolution', entityId: rowId, after: { round: round.number, candidates: round.candidates.length }, params: { officeId, round: round.number } });
    // L-2: Wer nach dem korrigierten Gang nicht mehr gewählt ist, verliert seine Erklärung — an der Quelle, damit jede
    // Stelle, die `elected` liest (Ausschluss-Vorschlag, Beschlussliste, Registeranlage, Mitlauf), nur Gewählte sieht.
    const saved = tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, rowId)).get()!;
    const winners = electionViewInternal(tx, deps, saved).winners;
    const dropped = details.elected.filter((e) => !winners.includes(e.contactId));
    if (dropped.length > 0) {
      tx.update(governanceResolutions).set({ details: { ...details, elected: winnerDeclarations(details, winners) } }).where(eq(governanceResolutions.id, rowId)).run();
      for (const e of dropped) recordAudit(tx, deps, ctx, { action: 'governance.election.declarationDropped', entityType: 'governanceResolution', entityId: rowId, before: e, params: { officeId, contactId: e.contactId } });
    }
    return ok(electionViewInternal(tx, deps, tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, rowId)).get()!));
  });
}

/**
 * Annahme oder Ablehnung der Wahl mit Tag (Vorgabe: Sitzungstag). Im Mitlauf nur die Schreibende; nach dem Ende der
 * Sitzung (Annahme Abwesender) mit `governance.record`. Die Amtsinhaberschaft entsteht beim Festschreiben (G4); nach dem
 * Festschreiben wirkt eine Annahme sofort.
 */
export async function acceptElection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ElectionView>> {
  const denied = requirePermission(ctx, 'governance.record');
  if (denied) return denied;
  const parsed = validate(deps, electionAcceptSchema, input);
  if (!parsed.ok) return parsed;
  const { resolutionId, contactId, declined = false } = parsed.value;
  const row = deps.db.select().from(governanceResolutions).where(eq(governanceResolutions.id, resolutionId)).get();
  if (!row || row.kind !== 'election' || !row.meetingId) return notFound('governanceResolution', resolutionId);
  const meeting = meetingRowInternal(deps.db, row.meetingId)!;
  const refused = loadForWrite(deps, ctx, meeting, true);
  if (refused) return refused;
  const details = row.details as ElectionDetails;
  if (!details.rounds.some((r) => r.unanimousContactId === contactId || r.candidates.some((c) => c.contactId === contactId))) return invalid([{ path: 'contactId', message: 'notCandidate' }]);
  // K-1: Erklären kann nur, wer gewählt ist (`winners`), nicht wer kandidiert und verloren hat.
  if (!electionViewInternal(deps.db, deps, row).winners.includes(contactId)) return invalid([{ path: 'contactId', message: 'notElected' }]);
  const on = parsed.value.acceptedOn ?? meeting.heldOn;
  // G-14: Eine Erklärung liegt zwischen Sitzungstag und heute.
  if (on > todayIn(deps)) return invalid([{ path: 'acceptedOn', message: 'inFuture' }]);
  if (on < meeting.heldOn) return invalid([{ path: 'acceptedOn', message: 'beforeMeeting' }]);
  // G-13 (A): Mit abgelegter unterschriebener Fassung gilt das Papier — nur noch die erste Erklärung einer Abwesenden; eine gespeicherte zu ändern ist eine Berichtigung.
  if (details.elected.some((e) => e.contactId === contactId) && minutesVersionsInternal(deps.db, meeting.id).length > 0) return governanceConflict('minutesFiled');
  const entry = { contactId, acceptedOn: declined ? null : on, declinedOn: declined ? on : null };
  const next: ElectionDetails = { ...details, elected: [...details.elected.filter((e) => e.contactId !== contactId), entry] };
  const sealed = meetingStateOf(meeting) === 'signed';
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      tx.update(governanceResolutions).set({ details: next, updatedAt: isoNow(deps.clock) }).where(eq(governanceResolutions.id, row.id)).run();
      recordAudit(tx, deps, ctx, { action: 'governance.election.accept', entityType: 'governanceResolution', entityId: row.id, after: entry, params: { officeId: details.officeId, contactId, acceptedOn: on, declined } });
      const current = tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, row.id)).get()!;
      if (sealed) applyLateAcceptanceInternal(tx, deps, ctx, current);
      return ok(electionViewInternal(tx, deps, tx.select().from(governanceResolutions).where(eq(governanceResolutions.id, row.id)).get()!));
    }),
  );
}
