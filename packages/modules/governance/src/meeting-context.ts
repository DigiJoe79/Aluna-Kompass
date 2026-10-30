import { notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documentLinks, documents } from '@kompass/module-dms';
import { assemblyPersonsInternal, financeFiscalYears } from '@kompass/module-finance';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { agendaItemsInternal } from './agenda';
import { attendanceOfInternal } from './attendance';
import { EMPTY_FINDINGS } from './findings';
import { invitationComplianceInternal, type InvitationCompliance } from './invitation/compliance';
import { invitationRecipientsInternal } from './invitation/runs';
import { meetingRowInternal, meetingStateOf } from './meetings';
import { contactNameInternal, resolutionSentencesInternal } from './minutes/compose';
import { minutesVersionsInternal, minutesVersionView, type MinutesVersionView } from './minutes/signed';
import { allVotingOnInternal, quorumInternal, type QuorumResult } from './quorum';
import type { ElectionDetails } from './resolution-details';
import { LAW_DEFAULT_MAJORITY } from './rules/law';
import { announceRequired, resolveMajority, resolveRule, type ResolvedRule } from './rules/resolve';
import { RESOLUTION_KINDS, type Majority, type OrganRules, type ResolutionKind } from './rules/schema';
import { sealPreviewInternal, type SealPreview } from './seal/preview';
import { governanceMotions, governanceOffices, governanceOrgans, governanceResolutions, governanceStatutes, governanceTerms, type OrganKind } from './schema';
import { meetingRulesInternal, statuteRulesOnInternal } from './statutes';

export const meetingContextSchema = z.object({ meetingId: z.string().min(1) });

type IssuedDocument = { documentId: string; number: string | null } | null;

/**
 * Was die Oberfläche zu einer Sitzung neben `getMeeting` liest (Plan U1 Task 1): Namen statt Kontakt-IDs, das
 * Regelwerk des Sitzungstags je TOP, die Sätze fürs Protokoll, Fassungen, ausgestellte Anlagen, Einladungsfrist,
 * Vorschau der Folgen und wer schreibt. Rein lesend, kein Protokolleintrag.
 */
export interface MeetingContext {
  organ: { id: string; kind: OrganKind; name: string };
  /** Stand, dessen Regelwerk am Sitzungstag gilt; `since` = Eintragung, sonst jüngstes Beschlussdatum. */
  statute: { id: string; since: string } | null;
  names: Record<string, string>;
  offices: { id: string; organId: string; name: string; seats: number; representative: boolean; termMonths: number | null; untilSuccessor: boolean }[];
  /** Die am Sitzungstag laufenden Amtszeiten (Namen in `names`) — Auswahl, wen eine Abberufung betrifft (G-3). */
  terms: { id: string; officeId: string; contactId: string }[];
  fiscalYears: { id: string; designation: string }[];
  rules: {
    quorum: Omit<QuorumResult, 'present' | 'met'>;
    assembly: boolean;
    allVoting: number;
    tie: 'rejected' | 'chairDecides';
    /** je TOP mit Beschlussart, sonst `null` */
    majorities: Record<string, ResolvedRule<Majority> | null>;
    /** je Beschlussart — für einen Punkt, dessen Art gerade gewählt wird */
    majorityByKind: Record<ResolutionKind, ResolvedRule<Majority>>;
    lateMotion: ResolvedRule<Majority>;
    election: ResolvedRule<NonNullable<OrganRules['election']>>;
    announceRequired: ResolutionKind[];
  };
  /** je TOP der Art `discharge` mit Geschäftsjahr: die vorgeschlagenen Betroffenen */
  discharge: Record<string, string[]>;
  /** Sätze fürs Protokoll je TOP-ID bzw. `motion:<motionId>` */
  sentences: Record<string, string[]>;
  minutes: MinutesVersionView[];
  issued: { attendanceList: IssuedDocument; registerData: IssuedDocument };
  compliance: InvitationCompliance | null;
  seal: SealPreview | null;
  writer: { userId: string | null; isCaller: boolean };
}

const isResolutionKind = (kind: string): kind is ResolutionKind => (RESOLUTION_KINDS as readonly string[]).includes(kind);

/** Das jüngste nicht stornierte Dokument einer Art an der Sitzung. */
function issuedOf(db: DbOrTx, meetingId: string, typeKey: string): IssuedDocument {
  const row = db
    .select({ documentId: documents.id, number: documents.number })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.documentId))
    .where(and(eq(documentLinks.entityType, 'governanceMeeting'), eq(documentLinks.entityId, meetingId), eq(documents.typeKey, typeKey), eq(documents.status, 'issued')))
    .orderBy(desc(documents.createdAt))
    .get();
  return row ?? null;
}

export function meetingContextInternal(db: DbOrTx, deps: Deps, ctx: CallContext, meetingId: string): MeetingContext {
  const meeting = meetingRowInternal(db, meetingId)!;
  const state = meetingStateOf(meeting);
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()!;
  const assembly = organ.kind === 'assembly';
  const { statuteId, rules } = statuteRulesOnInternal(db, meeting.heldOn);
  const statuteRow = statuteId ? db.select().from(governanceStatutes).where(eq(governanceStatutes.id, statuteId)).get() : undefined;
  const since = statuteRow ? (statuteRow.registeredOn ?? statuteRow.resolutions.map((r) => r.on).sort().at(-1) ?? null) : null;

  const items = agendaItemsInternal(db, meeting.id);
  const attendance = attendanceOfInternal(db, meeting.id);
  const motions = db.select().from(governanceMotions).where(eq(governanceMotions.meetingId, meeting.id)).all();
  const resolutions = db.select().from(governanceResolutions).where(eq(governanceResolutions.meetingId, meeting.id)).all();
  const findings = { ...EMPTY_FINDINGS, ...meeting.findings };

  const discharge: Record<string, string[]> = {};
  for (const item of items) {
    if (item.kind !== 'discharge' || !item.fiscalYearId) continue;
    const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, item.fiscalYearId)).get();
    discharge[item.id] = year ? assemblyPersonsInternal(db, year).map((p) => p.contactId) : [];
  }

  const seal = state === 'recorded' ? sealPreviewInternal(db, deps, { meetingId: meeting.id }) : null;

  const terms = db
    .select({ id: governanceTerms.id, officeId: governanceTerms.officeId, contactId: governanceTerms.contactId, since: governanceTerms.since, until: governanceTerms.until })
    .from(governanceTerms)
    .orderBy(asc(governanceTerms.since), asc(governanceTerms.id))
    .all()
    .filter((t) => t.since <= meeting.heldOn && (t.until === null || t.until >= meeting.heldOn))
    .map(({ id, officeId, contactId }) => ({ id, officeId, contactId }));

  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  for (const term of terms) add(term.contactId);
  for (const a of attendance) add(a.contactId);
  [meeting.plannedChairContactId, meeting.plannedMinuteTakerContactId, findings.chairContactId, findings.minuteTakerContactId].forEach(add);
  for (const m of motions) add(m.submittedByContactId);
  for (const r of resolutions) {
    r.excluded.forEach((e) => add(e.contactId));
    if (r.kind === 'election') {
      const d = r.details as ElectionDetails | null;
      d?.rounds.forEach((round) => {
        add(round.unanimousContactId);
        round.candidates.forEach((c) => add(c.contactId));
      });
      d?.elected.forEach((e) => add(e.contactId));
    }
    if (r.kind === 'discharge') ((r.details as { contactIds?: string[] } | null)?.contactIds ?? []).forEach(add);
  }
  Object.values(discharge).flat().forEach(add);
  for (const c of seal?.consequences ?? []) add(typeof c.params.contactId === 'string' ? c.params.contactId : null);
  // Vor der Sitzung: die Empfänger eines Einladungslaufs am heutigen Tag (Vorschau des Serienlaufs).
  if (assembly && (state === 'planned' || state === 'invited')) for (const m of invitationRecipientsInternal(db, deps, todayIn(deps))) add(m.contactId);
  const names: Record<string, string> = {};
  for (const id of ids) names[id] = contactNameInternal(db, id) ?? '';

  const late = resolveRule(rules, meeting.organId, 'lateMotionMajority');
  const election = resolveRule(meetingRulesInternal(db, meeting, null).rules, meeting.organId, 'election');
  // G-17: Eine Wahl folgt dem Wahlverfahren der Satzung (Mehrheit des ersten Gangs), nicht der Mehrheit je Beschlussart.
  const majorityOf = (kind: ResolutionKind, itemRules: typeof rules): ResolvedRule<Majority> => {
    if (kind !== 'election') return resolveMajority(itemRules, meeting.organId, kind);
    const rule = resolveRule(itemRules, meeting.organId, 'election');
    return rule.source === 'statute' && rule.value?.rounds[0] ? { ...rule, value: rule.value.rounds[0] } : resolveMajority(itemRules, meeting.organId, 'election');
  };
  const majorities: Record<string, ResolvedRule<Majority> | null> = {};
  for (const item of items) majorities[item.id] = isResolutionKind(item.kind) ? majorityOf(item.kind, meetingRulesInternal(db, meeting, item.id).rules) : null;
  const quorum = quorumInternal(db, deps, meeting.id, meeting.startsAt);
  const { present: _present, met: _met, ...quorumRule } = quorum;

  return {
    organ: { id: organ.id, kind: organ.kind, name: organ.name },
    statute: statuteId && since ? { id: statuteId, since } : null,
    names,
    offices: db
      .select()
      .from(governanceOffices)
      .orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.name))
      .all()
      .map((o) => ({ id: o.id, organId: o.organId, name: o.name, seats: o.seats, representative: o.representative, termMonths: o.termMonths, untilSuccessor: o.untilSuccessor })),
    terms,
    fiscalYears: db
      .select({ id: financeFiscalYears.id, designation: financeFiscalYears.designation })
      .from(financeFiscalYears)
      .orderBy(desc(financeFiscalYears.startsOn))
      .all(),
    rules: {
      quorum: quorumRule,
      assembly,
      allVoting: allVotingOnInternal(db, deps, meeting.organId, meeting.heldOn),
      tie: resolveRule(rules, meeting.organId, 'tie').value ?? 'rejected',
      majorities,
      majorityByKind: Object.fromEntries(RESOLUTION_KINDS.map((k) => [k, majorityOf(k, rules)])) as Record<ResolutionKind, ResolvedRule<Majority>>,
      lateMotion: late.value ? { ...late, value: late.value } : { value: LAW_DEFAULT_MAJORITY.value, source: 'law', norm: LAW_DEFAULT_MAJORITY.norm },
      election: { ...election, value: election.value ?? { mode: 'single', rounds: [LAW_DEFAULT_MAJORITY.value], runoff: false } },
      announceRequired: RESOLUTION_KINDS.filter((k) => announceRequired(rules, meeting.organId, k)),
    },
    discharge,
    sentences: resolutionSentencesInternal(db, deps, meeting.id),
    minutes: minutesVersionsInternal(db, meeting.id).map((r) => minutesVersionView(db, r)),
    issued: { attendanceList: issuedOf(db, meeting.id, 'governance-attendance'), registerData: issuedOf(db, meeting.id, 'governance-register-data') },
    compliance: state === 'planned' || state === 'cancelled' ? null : invitationComplianceInternal(db, deps, meeting.id),
    seal,
    writer: { userId: meeting.writerUserId, isCaller: meeting.writerUserId !== null && meeting.writerUserId === ctx.userId },
  };
}

/** `governance.read`: die Lesedaten für Sitzung und Mitlauf (Plan U1). */
export async function getMeetingContext(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingContext>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, meetingContextSchema, input);
  if (!parsed.ok) return parsed;
  if (!meetingRowInternal(deps.db, parsed.value.meetingId)) return notFound('governanceMeeting', parsed.value.meetingId);
  return ok(meetingContextInternal(deps.db, deps, ctx, parsed.value.meetingId));
}
