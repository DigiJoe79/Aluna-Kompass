import { readSetting, type DbOrTx, type Deps } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { financeFiscalYears } from '@kompass/module-finance';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { agendaViewsInternal } from '../agenda';
import { attendanceOfInternal } from '../attendance';
import { electionViewInternal, winnerDeclarations } from '../elections';
import { EMPTY_FINDINGS } from '../findings';
import { FORM_WORDS, meetingTitle } from '../invitation/words';
import { meetingRowInternal } from '../meetings';
import type { ElectionDetails } from '../resolution-details';
import { againstCount, resolutionViewInternal } from '../resolutions';
import { LAW_FALLBACK } from '../rules/law';
import { allVotingOnInternal } from '../quorum';
import { resolveRule } from '../rules/resolve';
import { majorityPhrase, referenceOf } from '../rules/words';
import { governanceAgendaItems, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type MeetingRow, type OrganRow, type ResolutionRow } from '../schema';
import { meetingRulesInternal, resolutionRulesInternal } from '../statutes';
import { termRunsOn } from '../term-schedule';
import { meetingDefectsInternal, type MinutesDefect } from './defects';
import { MINUTES_WORDS } from './words';

const text = (max: number) => z.string().max(max);

/** Eingabe der Protokollvorlage: fertige Sätze — `build` bleibt rein (Muster Einladung). */
export const minutesInputSchema = z.object({
  title: text(400).min(1),
  head: z.array(z.object({ label: text(60), value: text(1000) })).max(10),
  /** Feststellungen, dazu die Aufnahme später Anträge ohne Platz in der Tagesordnung (G-6). */
  findings: z.array(text(25000)).max(60),
  /** Je TOP: Sätze, dann die Mängel als eigene Absätze (Plan U2). */
  items: z.array(z.object({ heading: text(400), paragraphs: z.array(text(25000)).max(200), defects: z.array(text(3000)).max(30).default([]) })).max(200),
  defects: z.array(text(3000)).max(30),
  end: text(200),
  placeDate: text(400),
  signatures: z.array(text(400)).max(10),
  attachments: z.array(text(200)).max(100),
  /** „Unterschriften nach {Fundstelle}.“ — leer ohne Regel in der Satzung. */
  signaturesNote: text(300).default(''),
  /** Fußzeile des Entwurfs; setzt der Ausdruck (`print.ts`). */
  footerNote: text(200).default(''),
});
export type MinutesInput = z.infer<typeof minutesInputSchema>;

/** Der Name eines Kontakts für das Protokoll-Dokument; gelöschte Kontakte bleiben ohne Namen. */
export function contactNameInternal(db: DbOrTx, contactId: string | null): string | null {
  if (!contactId) return null;
  const row = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return row ? displayName(row) : MINUTES_WORDS.deletedContact;
}

/** Wie viele anwesend waren (irgendwann in der Sitzung), davon stimmberechtigt und Gäste — wie die Anwesenheitsliste (G-12). */
export function attendanceCountsInternal(db: DbOrTx, meeting: MeetingRow): { persons: number; voting: number; guests: number } {
  if (meeting.backfilled && meeting.backfillPresent !== null) return { persons: meeting.backfillPresent, voting: meeting.backfillVoting ?? 0, guests: 0 };
  const present = attendanceOfInternal(db, meeting.id).filter((r) => r.periods.length > 0);
  return { persons: present.length, voting: present.filter((r) => !r.guest && r.votingRight).length, guests: present.filter((r) => r.guest).length };
}

function electionSentences(db: DbOrTx, deps: Deps, row: ResolutionRow, organKind: OrganRow['kind']): string[] {
  const details = row.details as ElectionDetails;
  const office = db.select().from(governanceOffices).where(eq(governanceOffices.id, details.officeId)).get();
  const officeName = office?.name ?? '';
  const name = (contactId: string) => contactNameInternal(db, contactId) ?? '';
  const lines: string[] = [];
  // K-6: Wählt ein TOP mehrere Ämter, beginnt jedes mit seiner Zeile — sonst stünde das Amt erst im Ergebnis-Satz.
  const item = row.agendaItemId ? db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.id, row.agendaItemId)).get() : undefined;
  const siblings = row.agendaItemId ? db.select().from(governanceResolutions).where(eq(governanceResolutions.agendaItemId, row.agendaItemId)).all().filter((r) => r.kind === 'election').length : 0;
  if ((item?.officeIds.length ?? 0) > 1 || siblings > 1) lines.push(MINUTES_WORDS.electionOf(officeName));
  const several = details.rounds.length > 1;
  const view = electionViewInternal(db, deps, row);
  // W-8: Wie bei jedem gezählten Beschluss, was nötig war — je Gang die Mehrheit aus dem Regelwerk (Wahlverfahren).
  const rule = resolveRule(resolutionRulesInternal(db, row).rules, row.organId, 'election');
  const electionRule = rule.value ? rule : { ...LAW_FALLBACK.election, source: 'law' as const };
  details.rounds.forEach((round, index) => {
    if (several) lines.push(MINUTES_WORDS.round(round.number, round.runoff));
    if (round.unanimousContactId) {
      lines.push(MINUTES_WORDS.electedUnanimously(name(round.unanimousContactId)));
      return;
    }
    for (const c of [...round.candidates].sort((a, b) => b.votes - a.votes)) lines.push(MINUTES_WORDS.candidateVotes(name(c.contactId), c.votes));
    if (round.no + round.abstain + round.invalid > 0) lines.push(MINUTES_WORDS.roundRest(round.no, round.abstain, round.invalid));
    const majority = electionRule.value!.rounds[index] ?? electionRule.value!.rounds.at(-1);
    const needed = view.rounds.find((r) => r.number === round.number)?.needed ?? 0;
    if (majority && needed > 0) lines.push(MINUTES_WORDS.required(majorityPhrase(majority, organKind), needed, referenceOf(electionRule)));
  });
  // K-1: Der Satz „wurde gewählt …“ nur für Gewählte, nie aus einer Erklärung einer Unterlegenen.
  const declarations = winnerDeclarations(details, view.winners);
  const declared = new Set(declarations.map((e) => e.contactId));
  for (const e of declarations) {
    if (e.acceptedOn) lines.push(MINUTES_WORDS.accepted(name(e.contactId), officeName, e.acceptedOn));
    else if (e.declinedOn) lines.push(MINUTES_WORDS.declined(name(e.contactId), officeName, e.declinedOn));
  }
  // Über alle Gänge (G-2): Wer im ersten Gang gewählt ist und noch nicht erklärt hat, steht auch nach einer Stichwahl da.
  const winners = view.winners;
  for (const contactId of winners.filter((c) => !declared.has(c))) lines.push(MINUTES_WORDS.notYetAccepted(name(contactId), officeName));
  return lines;
}

/** Vor dem Ergebnis einer Entlastung: wen sie betrifft, für welches Geschäftsjahr (G-7). */
function dischargeLines(db: DbOrTx, row: ResolutionRow): string[] {
  const d = row.kind === 'discharge' ? (row.details as { fiscalYearId: string; mode: 'individual' | 'collective'; contactIds: string[] } | null) : null;
  if (!d || d.contactIds.length === 0) return [];
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, d.fiscalYearId)).get();
  return [MINUTES_WORDS.dischargeOf(d.contactIds.map((c) => contactNameInternal(db, c) ?? ''), year?.designation ?? '', d.mode)];
}

/** Die Abstimmung über die Aufnahme eines späten Antrags: der Antrag, sonst `null`. */
export const admissionMotionId = (row: Pick<ResolutionRow, 'kind' | 'agendaItemId' | 'details'>): string | null =>
  row.kind === 'agenda' && !row.agendaItemId ? ((row.details as { motionId?: string } | null)?.motionId ?? null) : null;

/**
 * Wo die Aufnahme eines späten Antrags im Protokoll steht (G-6): beim Antrag aus der Versammlung hinter dem TOP, an
 * dem er gestellt wurde; sonst bei den Feststellungen zu Beginn (`null`), wo auch die Tagesordnung genehmigt wird.
 */
export const admissionItemId = (row: Pick<ResolutionRow, 'details'>): string | null => (row.details as { afterItemId?: string } | null)?.afterItemId ?? null;

function resolutionSentences(db: DbOrTx, deps: Deps, row: ResolutionRow, subject: string, organKind: OrganRow['kind']): string[] {
  if (row.kind === 'election') return electionSentences(db, deps, row, organKind);
  const lines: string[] = [...dischargeLines(db, row)];
  const v = row.votes;
  const admission = admissionMotionId(row) !== null;
  switch (row.outcome) {
    case 'adopted':
      if (admission) lines.push(row.unanimous || !v ? MINUTES_WORDS.admissionUnanimous(subject, row.text) : MINUTES_WORDS.admissionAdopted(subject, v, row.yesComputed, row.text));
      else lines.push(row.unanimous ? MINUTES_WORDS.unanimous(subject, row.text) : v ? MINUTES_WORDS.adopted(subject, v, row.yesComputed, row.text) : MINUTES_WORDS.adoptedPlain(subject, row.text));
      break;
    case 'rejected':
      if (admission && v) lines.push(MINUTES_WORDS.admissionRejected(v, row.yesComputed, row.text));
      else lines.push(v ? MINUTES_WORDS.rejected(v, row.yesComputed, row.text) : MINUTES_WORDS.rejectedPlain(row.text));
      break;
    case 'postponed':
      lines.push(v && !row.unanimous ? MINUTES_WORDS.postponedVotes(v, row.yesComputed) : MINUTES_WORDS.postponed);
      break;
    case 'withdrawn':
      lines.push(MINUTES_WORDS.withdrawn);
      break;
    default:
      break;
  }
  const evaluation = resolutionViewInternal(db, deps, row).evaluation;
  const decided = row.outcome === 'adopted' || row.outcome === 'rejected';
  // W-8: Die Begründung einer Vertagung — gegen die Zählung steht sie schon beim Hinweis.
  if (row.outcome === 'postponed' && row.outcomeReason && !againstCount(row.outcome, evaluation)) lines.push(MINUTES_WORDS.chairReason(row.outcomeReason));
  // Gezählt und nicht einstimmig: was nötig war, mit der Zahl aus der Auswertung (Plan U2), auch vor einer Vertagung (W-8).
  if (evaluation && (decided || row.outcome === 'postponed') && v && !row.unanimous) lines.push(MINUTES_WORDS.required(majorityPhrase(evaluation.required.value, organKind), evaluation.result.needed, referenceOf(evaluation.required)));
  if (evaluation?.result.tie && evaluation.result.reached === null && decided) lines.push(MINUTES_WORDS.tieDecided(organKind, row.outcome as 'adopted' | 'rejected'));
  const excluded = evaluation?.excluded ?? 0;
  if (excluded > 0 && decided) lines.push(MINUTES_WORDS.excluded(excluded));
  return lines;
}

/** Wer unterschreibt: nach Regelwerk (`minutesSignedBy`), sonst Leitung und Protokollführung. */
function signatures(db: DbOrTx, meeting: MeetingRow, organKind: OrganRow['kind']): string[] {
  const findings = { ...EMPTY_FINDINGS, ...meeting.findings };
  const signers = resolveRule(meetingRulesInternal(db, meeting, null).rules, meeting.organId, 'minutesSignedBy').value ?? ['chair', 'minuteTaker'];
  return signers.map((signer) => {
    if (signer === 'chair') return MINUTES_WORDS.signature(MINUTES_WORDS.signatureChair(organKind), contactNameInternal(db, findings.chairContactId ?? meeting.plannedChairContactId));
    if (signer === 'minuteTaker') return MINUTES_WORDS.signature(MINUTES_WORDS.signatureMinuteTaker, contactNameInternal(db, findings.minuteTakerContactId ?? meeting.plannedMinuteTakerContactId));
    const office = db.select().from(governanceOffices).where(eq(governanceOffices.id, signer)).get();
    if (!office) return MINUTES_WORDS.signature(signer, null);
    const holder = db.select().from(governanceTerms).where(eq(governanceTerms.officeId, office.id)).all().find((t) => termRunsOn(t, office, meeting.heldOn));
    return MINUTES_WORDS.signature(office.name, contactNameInternal(db, holder?.contactId ?? null));
  });
}

const defectLines = (defects: MinutesDefect[]) => defects.flatMap((d) => MINUTES_WORDS.defect(d));
/** Ein Mangel als ein Absatz (Hinweis, Begründung, Wirkung). */
const defectParagraphs = (defects: MinutesDefect[]) => defects.map((d) => MINUTES_WORDS.defect(d).join(' '));
/** Die Notiz des TOP (Spec § 5.4) vor dem Ergebnis; Leerzeilen trennen Absätze. */
const noteParagraphs = (note: string | null) => (note ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);

/**
 * Die Sätze des Protokolls je TOP-ID (Ergebnisse, dann Mängel des TOP) und je `motion:<motionId>` für die Aufnahme
 * eines späten Antrags — dieselben wie im Entwurf, ohne Notiz. Der Mitlauf zeigt sie unter „Im Protokoll“ (Plan U1).
 */
export function resolutionSentencesInternal(db: DbOrTx, deps: Deps, meetingId: string): Record<string, string[]> {
  const meeting = meetingRowInternal(db, meetingId)!;
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get() as OrganRow;
  const subject = MINUTES_WORDS.subject(organ.kind, organ.name);
  const defects = meetingDefectsInternal(db, deps, meetingId);
  const resolutions = db.select().from(governanceResolutions).where(eq(governanceResolutions.meetingId, meetingId)).orderBy(asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id)).all();
  const out: Record<string, string[]> = {};
  for (const item of agendaViewsInternal(deps, db, meeting)) {
    out[item.id] = [...resolutions.filter((r) => r.agendaItemId === item.id).flatMap((r) => resolutionSentences(db, deps, r, subject, organ.kind)), ...defectLines(defects.filter((d) => d.agendaItemId === item.id))];
  }
  for (const r of resolutions) {
    const motionId = r.kind === 'agenda' && !r.agendaItemId ? (r.details as { motionId?: string } | null)?.motionId : undefined;
    if (motionId) out[`motion:${motionId}`] = [...(out[`motion:${motionId}`] ?? []), ...resolutionSentences(db, deps, r, subject, organ.kind)];
  }
  return out;
}

/**
 * Der Protokollentwurf einer Sitzung als fertige Sätze (Spec § 5.5): Kopf, Anwesenheit nur als Zahl (die Liste ist
 * eine eigene Anlage), Feststellungen, je TOP Notiz, Ergebnisse und Mängel, Ende, Unterschriftszeilen, Anlagen. Namen
 * stehen im Dokument, aber kein Geburtsdatum, kein Wohnort, keine Anschrift; der Zugang zur Sitzung nie.
 */
export function composeMinutesInternal(db: DbOrTx, deps: Deps, meetingId: string): MinutesInput {
  const meeting = meetingRowInternal(db, meetingId)!;
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get() as OrganRow;
  const findings = { ...EMPTY_FINDINGS, ...meeting.findings };
  const subject = MINUTES_WORDS.subject(organ.kind, organ.name);
  const counts = attendanceCountsInternal(db, meeting);
  const head = [
    { label: MINUTES_WORDS.headDate, value: MINUTES_WORDS.date(meeting.heldOn) },
    { label: MINUTES_WORDS.headTime, value: MINUTES_WORDS.time(meeting.startsAt, meeting.endedAt) },
    { label: MINUTES_WORDS.headForm, value: FORM_WORDS[meeting.form] },
    ...(meeting.place ? [{ label: MINUTES_WORDS.headPlace, value: meeting.place }] : []),
  ];
  const chair = contactNameInternal(db, findings.chairContactId);
  const minuteTaker = contactNameInternal(db, findings.minuteTakerContactId);
  if (chair) head.push({ label: MINUTES_WORDS.headChair, value: chair });
  if (minuteTaker) head.push({ label: MINUTES_WORDS.headMinuteTaker, value: minuteTaker });
  head.push({ label: MINUTES_WORDS.headAttendance, value: MINUTES_WORDS.attendanceHead(counts.voting, Math.max(counts.voting, allVotingOnInternal(db, deps, meeting.organId, meeting.heldOn)), counts.persons - counts.voting - counts.guests, counts.guests, organ.kind) });

  const findingLines: string[] = [];
  if (findings.chairBy) findingLines.push(MINUTES_WORDS.chairBy[findings.chairBy]);
  if (findings.invitationProper !== null) findingLines.push(MINUTES_WORDS.invitationProper(findings.invitationProper, organ.kind));
  if (findings.quorate !== null) findingLines.push(MINUTES_WORDS.quorate(findings.quorate, organ.kind));
  if (findings.agendaApproved !== null) findingLines.push(MINUTES_WORDS.agendaApproved(findings.agendaApproved));

  const defects = meetingDefectsInternal(db, deps, meetingId);
  const agenda = agendaViewsInternal(deps, db, meeting);
  const resolutions = db.select().from(governanceResolutions).where(eq(governanceResolutions.meetingId, meetingId)).orderBy(asc(governanceResolutions.votedAt), asc(governanceResolutions.createdAt), asc(governanceResolutions.id)).all();
  const admissions = resolutions.filter((r) => admissionMotionId(r) !== null);
  const admissionLines = (itemId: string | null) => admissions.filter((r) => admissionItemId(r) === itemId).flatMap((r) => resolutionSentences(db, deps, r, subject, organ.kind));
  findingLines.push(...admissionLines(null));
  const items = agenda.map((item) => ({
    heading: MINUTES_WORDS.heading(item.position, item.title),
    paragraphs: [...noteParagraphs(item.minutesNote), ...resolutions.filter((r) => r.agendaItemId === item.id).flatMap((r) => resolutionSentences(db, deps, r, subject, organ.kind)), ...admissionLines(item.id)],
    defects: defectParagraphs(defects.filter((d) => d.agendaItemId === item.id)),
  }));
  const signedBy = resolveRule(meetingRulesInternal(db, meeting, null).rules, meeting.organId, 'minutesSignedBy');

  const docIds = [...new Set([...(meeting.invitationDocumentId ? [meeting.invitationDocumentId] : []), ...agenda.flatMap((i) => i.attachmentDocumentIds)])];
  const numbers = new Map(docIds.length ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, docIds)).all().map((d) => [d.id, d.number ?? '']) : []);
  const attachments = [MINUTES_WORDS.attachmentAttendance];
  if (meeting.invitationDocumentId && numbers.get(meeting.invitationDocumentId)) attachments.push(MINUTES_WORDS.attachmentInvitation(numbers.get(meeting.invitationDocumentId)!));
  for (const id of agenda.flatMap((i) => i.attachmentDocumentIds)) if (numbers.get(id)) attachments.push(MINUTES_WORDS.attachmentDocument(numbers.get(id)!));

  const city = (readSetting<string>(deps, 'organization.city') ?? '').trim();
  return {
    title: MINUTES_WORDS.title(meetingTitle(meeting.kind, organ.name)),
    head,
    findings: findingLines,
    items,
    defects: defectLines(defects.filter((d) => d.agendaItemId === null)),
    end: meeting.endedAt ? MINUTES_WORDS.end(meeting.endedAt) : '',
    placeDate: MINUTES_WORDS.placeDate(city || meeting.place || '', meeting.heldOn),
    signatures: signatures(db, meeting, organ.kind),
    attachments: [...new Set(attachments)],
    signaturesNote: signedBy.source === 'statute' ? MINUTES_WORDS.signaturesNote(referenceOf(signedBy)) : '',
    footerNote: '',
  };
}
