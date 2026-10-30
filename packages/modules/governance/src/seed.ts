import { completeFollowUpsInternal, isoDay, paperDate, SEED_CLOSED_YEARS, seedClockAt, seedMoment, seedStoryYear, todayIn, unwrap, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { addCalendarDays, financeFiscalYears, financeReserveMovements, financeReserves, linkResolution } from '@kompass/module-finance';
import { listFeeSchedules, memberFeeSchedules, saveFeeSchedule } from '@kompass/module-members';
import { contactRoles, contacts, createContact, endRoleRowInternal, startRoleRowInternal } from '@kompass/module-contacts';
import { and, eq } from 'drizzle-orm';
import { saveOrgan, setOrganActive } from './organs';
import { saveOffice } from './offices';
import type { StatuteRules } from './rules/schema';
import { proposeAgenda } from './agenda-proposal';
import { saveAssemblyRequest } from './assembly-requests';
import { recordInvitationNote } from './invitation/board';
import { invitationDispatchState, markInvitationPostDispatched, sendInvitationMails } from './invitation/dispatch';
import { continueInvitationRun, startInvitationRun, type InvitationRunView } from './invitation/runs';
import { cancelMeeting, createMeeting } from './meetings';
import { saveMotion } from './motions';
import { prefillAttendance, recordArrival } from './attendance';
import { createCircular, decideCircular, getCircular, saveCircularResponse } from './circulars';
import { saveDischarge } from './discharge';
import { saveFindings } from './findings';
import { decideResolution, saveResolution } from './resolutions';
import { acceptElection, saveElectionRound } from './elections';
import { backfillMeeting } from './backfill';
import { saveAttendance } from './attendance';
import { fileSignedMinutes } from './minutes/signed';
import { sealCircular, sealMeeting } from './seal/seal';
import { receiveDocument, textPdf } from '@kompass/module-dms';
import { isNotNull } from 'drizzle-orm';
import { endMeeting, startMeeting } from './session';
import { saveAgendaItem } from './agenda';
import { setAgendaNote } from './agenda-note';
import { governanceCirculars, governanceMeetings, governanceOffices, governanceOrgans, governanceRegisterFilings, governanceRegisterOccasions, governanceResolutions, governanceStatutes, governanceTerms, type OfficeFunction } from './schema';
import { createStatuteDraft, registerStatute, updateStatute } from './statutes';
import { completeRegisterFiling } from './register/complete';
import { createRegisterFiling, updateRegisterFiling } from './register/filings';
import { recordInterimOrder } from './register/interim-orders';
import { adoptRoleRows, endTerm, startTerm } from './terms';

/**
 * Personen frei erfunden — das Repo ist öffentlich (`no-association-content.test.ts`). Dieselben wie im Seed der
 * Finanzen und Kontakte (V-2: eine Vereinsgeschichte): Gremien übernimmt deren Rollenzeilen, statt eigene Leute zu
 * erfinden; fehlen sie (Modultest ohne Finanzen), legt der Seed sie hier an.
 */
const PEOPLE = {
  chairBefore: { firstName: 'Bernd', lastName: 'Hagedorn' },
  chair: { firstName: 'Clara', lastName: 'Neumann' },
  deputy: { firstName: 'Thomas', lastName: 'Wendt' },
  treasurerBefore: { firstName: 'Tanja', lastName: 'Gerber' },
  treasurer: { firstName: 'Lena', lastName: 'Brückner' },
  assessor: { firstName: 'Helga', lastName: 'Sommer' },
  auditorOne: { firstName: 'Mira', lastName: 'Klein' },
  auditorTwo: { firstName: 'Holger', lastName: 'Brandt' },
} as const;
type Person = { firstName: string; lastName: string };

/** Der Kontakt zur Person — gefunden über den Namen, sonst neu angelegt. */
async function personId(deps: Deps, ctx: CallContext, p: Person): Promise<string> {
  const known = deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, p.firstName), eq(contacts.lastName, p.lastName))).get();
  return known?.id ?? unwrap(await createContact(deps, ctx, { kind: 'person', ...p })).id;
}

/**
 * Die Rollenzeile von vor Gremien (aus dem Seed der Finanzen) — oder, ohne ihn, eine gleiche von Hand. Direkt als Zeile:
 * Solange Gremien eingeschaltet ist, lehnt `addContactRole` die Rolle ab (es führt sie selbst).
 */
function handRow(deps: Deps, ctx: CallContext, contactId: string, row: { role: string; since: string; until?: string; note?: string; representsAssociation?: boolean }): string {
  const known = deps.db.select({ id: contactRoles.id }).from(contactRoles).where(and(eq(contactRoles.contactId, contactId), eq(contactRoles.role, row.role))).get();
  if (known) return known.id;
  return deps.db.transaction((tx) => {
    const id = startRoleRowInternal(tx, deps, ctx, { contactId, role: row.role, since: row.since, note: row.note ?? null, representsAssociation: row.representsAssociation ?? false });
    if (row.until) endRoleRowInternal(tx, deps, ctx, { rowId: id, until: row.until });
    return id;
  });
}

/**
 * Regelwerk mit Abweichungen vom BGB (Spec Gremien § 14): Quorum, Satzungsmehrheit, Wahl in zwei Gängen, beim Vorstand
 * Gleichstand, Ersatzbestellung und Vertretung zu zweit.
 */
function rulesFor(mv: string, board: string, statuteMajority: { num: number; den: number }, remuneration = false): StatuteRules {
  return {
    organs: {
      [mv]: {
        noticeDays: 14,
        noticeStrictness: 'must',
        noticeFrom: 'received',
        form: 'textForm',
        motionDeadlineDays: 7,
        quorum: { kind: 'fraction', fraction: { num: 1, den: 4 }, base: 'allMembers' },
        repeatMeeting: { withinDays: 28, noQuorum: true },
        majorities: { statute: { fraction: statuteMajority, base: 'present', abstentions: 'ignored' } },
        election: {
          mode: 'single',
          rounds: [
            { fraction: 'simple', base: 'present', abstentions: 'ignored' },
            { fraction: 'simple', base: 'cast', abstentions: 'ignored' },
          ],
          runoff: true,
        },
      },
      [board]: {
        noticeDays: 7,
        noticeStrictness: 'should',
        quorum: { kind: 'absolute', count: 2 },
        tie: 'chairDecides',
        substitutionAllowed: true,
        representation: { mode: 'two', text: 'Der Verein wird durch zwei Vorstandsmitglieder gemeinsam vertreten.' },
        // K-8: Seit der Änderung des Vorjahres erlaubt die Satzung eine Vergütung des Vorstands (§ 7 Abs. 5).
        ...(remuneration ? { remuneration: { statuteReference: '§ 7 Abs. 5 Satzung', decidedBy: mv } } : {}),
      },
    },
    references: { [mv]: { quorum: '§ 9 Abs. 2 Satzung', 'majorities.statute': '§ 12 Abs. 1 Satzung' }, [board]: { substitutionAllowed: '§ 7 Abs. 4 Satzung', representation: '§ 7 Abs. 2 Satzung' } },
  };
}

/**
 * Beispieldaten (Spec § 14), je Block nur einmal. Alle Tage im Stichjahr `y` und den abgeschlossenen Jahren davor, nie
 * in der Zukunft (AGENTS.md: kalenderfest) — außer der Wiedervorlage eines Auftrags und den Sitzungen aus Block G2.
 */
export async function seedGovernance(deps: Deps, ctx: CallContext): Promise<void> {
  await seedStructure(deps, ctx);
  await seedMeetings(deps, ctx);
  await seedMinutes(deps, ctx);
  await seedSealing(deps, ctx);
  await seedRegister(deps, ctx);
}

/** Block G1: Organe, Ämter, Satzung — nur ohne Amtsinhaberschaft. */
async function seedStructure(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: governanceTerms.id }).from(governanceTerms).get()) return;
  const organs = deps.db.select().from(governanceOrgans).all();
  const mv = organs.find((o) => o.kind === 'assembly');
  const board = organs.find((o) => o.kind === 'board');
  const office = (fn: OfficeFunction) => deps.db.select().from(governanceOffices).where(eq(governanceOffices.function, fn)).get()?.id;
  const [chair, deputy, treasurer, auditor] = [office('chair'), office('board'), office('treasurer'), office('auditor')];
  if (!mv || !board || !chair || !deputy || !treasurer || !auditor) return; // Grundausstattung umgebaut
  const y = seedStoryYear(todayIn(deps));
  const founded = y - SEED_CLOSED_YEARS;

  // Ein Beirat, der nicht mehr besteht.
  const advisory = unwrap(await saveOrgan(deps, ctx, { kind: 'other', name: 'Beirat' }));
  unwrap(await setOrganActive(deps, ctx, { id: advisory.id, active: false }));

  // Satzung: Gründungsfassung, eine eingetragene Änderung, ein beschlossener Stand mit offener Eintragung.
  const founding = unwrap(await createStatuteDraft(deps, ctx, { note: 'Gründungssatzung' }));
  unwrap(
    await updateStatute(deps, ctx, {
      id: founding.id,
      resolutions: [{ on: `${founded}-02-10`, resolutionId: null }],
      rules: rulesFor(mv.id, board.id, { num: 2, den: 3 }),
      foundingChecks: { signatures: 8, establishedOn: `${founded}-02-10` },
      taxReview: { affectsCharity: true, submittedOn: `${founded}-01-20`, submissionDocumentId: null, answer: 'newNotice', answerDocumentId: null },
    }),
  );
  unwrap(await registerStatute(deps, ctx, { id: founding.id, registeredOn: `${founded}-04-20` }));
  const amendment = unwrap(await createStatuteDraft(deps, ctx, { basedOnId: founding.id, note: 'Antragsfrist und Wahlverfahren' }));
  // Der Wortlaut des gültigen Stands liegt in der Akte (V-2), eingegangen am Tag des Beschlusses (`seedClockAt`).
  const text = unwrap(await receiveDocument(seedClockAt(deps, seedMoment(deps, `${y - 1}-03-20`, '21:00')), ctx, { filename: 'Satzung.pdf', typeKey: 'unclassified-in', subject: 'Satzung, Fassung der Änderung', documentDate: `${y - 1}-03-20`, folder: null, bytes: textPdf(['Satzung des Vereins', 'Fassung vom Beschluss der Mitgliederversammlung', 'Erfundenes Beispiel für die Entwicklung.']) }));
  unwrap(
    await updateStatute(deps, ctx, {
      id: amendment.id,
      documentId: text.id,
      resolutions: [{ on: `${y - 1}-03-20`, resolutionId: null }],
      rules: rulesFor(mv.id, board.id, { num: 2, den: 3 }, true),
      taxReview: { affectsCharity: false, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null },
    }),
  );
  unwrap(await registerStatute(deps, ctx, { id: amendment.id, registeredOn: `${y - 1}-06-01` }));
  const open = unwrap(await createStatuteDraft(deps, ctx, { basedOnId: amendment.id, note: 'Satzungszweck erweitert' }));
  unwrap(
    await updateStatute(deps, ctx, {
      id: open.id,
      resolutions: [{ on: `${y}-06-15`, resolutionId: null }],
      rules: rulesFor(mv.id, board.id, { num: 3, den: 4 }, true),
      taxReview: { affectsCharity: true, submittedOn: `${y}-05-02`, submissionDocumentId: null, answer: null, answerDocumentId: null },
    }),
  );

  // Der Vorstand, wie ihn Finanzen und Kontakte seit jeher führen (V-2): Gremien übernimmt die Zeilen von vor Kompass.
  // Stellvertretung seit der Gründung, Vorsitz bis zur Wahl der Nachfolgerin im Stichjahr, die Kasse seit dem Vorjahr.
  // Entlastet werden sie in den Versammlungen im März (Block G4); ältere Jahre tragen ein Ergebnis der Finanzen von Hand.
  const adopt = async (p: Person, officeId: string, row: Parameters<typeof handRow>[3]) => {
    const rowId = handRow(deps, ctx, await personId(deps, ctx, p), row);
    unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId }] }));
  };
  await adopt(PEOPLE.deputy, deputy, { role: 'board-member', since: `${founded}-02-10`, note: 'Stellvertretender Vorsitzender', representsAssociation: true });
  // Die erste Amtszeit lief nach zwei Jahren ab; bis zur Wiederwahl in der ordentlichen Versammlung des Stichjahres
  // (14.03., Block G4) blieb er bis zur Neuwahl im Amt — nachgetragen, damit keine Amtszeit von vor zwei Jahren als
  // „endet“ in den Fristen steht.
  const firstDeputyTerm = deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, deputy)).get()!;
  unwrap(await endTerm(deps, ctx, { id: firstDeputyTerm.id, until: `${y}-03-13`, reason: 'expired' }));
  unwrap(await startTerm(deps, ctx, { officeId: deputy, contactId: firstDeputyTerm.contactId, since: `${y}-03-14`, origin: 'backfilled' }));
  await adopt(PEOPLE.chairBefore, chair, { role: 'board-member', since: `${founded}-04-01`, until: `${y}-04-28`, note: 'Vorsitzender', representsAssociation: true });
  await adopt(PEOPLE.chair, chair, { role: 'board-member', since: `${y}-04-29`, note: 'Vorsitzende', representsAssociation: true });
  // Kasse mit Wechsel im Stichjahr (Rücktritt mit Zugang, Ersatzbestellung durch den Vorstand) — zur Amtsübergabe der
  // Finanzen am 30.06.
  await adopt(PEOPLE.treasurerBefore, treasurer, { role: 'treasurer', since: `${y - 1}-01-01` });
  const before = deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, treasurer)).get()!;
  unwrap(await endTerm(deps, ctx, { id: before.id, until: `${y}-06-30`, reason: 'resigned', receivedOn: `${y}-06-10` }));
  unwrap(await startTerm(deps, ctx, { officeId: treasurer, contactId: await personId(deps, ctx, PEOPLE.treasurer), since: `${y}-07-01`, origin: 'substitute' }));
  // Eine Beisitzerin ohne Vertretung (Finanzen: Pauschale an ein Vorstandsmitglied).
  const assessor = unwrap(await saveOffice(deps, ctx, { organId: board.id, name: 'Beisitz', seats: 1, representative: false, termMonths: 24, untilSuccessor: true, function: 'board', incompatibleWith: [] })).id;
  await adopt(PEOPLE.assessor, assessor, { role: 'board-member', since: `${y}-01-01`, note: 'Beisitzerin' });

  // Zwei Kassenprüfer seit der Versammlung der Satzungsänderung (nachgetragen); ihre Rolle zählt nicht zur Entlastung.
  for (const p of [PEOPLE.auditorOne, PEOPLE.auditorTwo]) unwrap(await startTerm(deps, ctx, { officeId: auditor, contactId: await personId(deps, ctx, p), since: `${y - 1}-03-20`, origin: 'backfilled' }));
}

/**
 * Block G2 (Plan G2 Task 7), nur ohne Sitzung: Die geplante ordentliche Versammlung liegt bewusst 30 Tage nach heute
 * (Frist offen, `FUTURE_ALLOWED`), ihr Einladungslauf hat fünf Briefe ausgestellt und läuft noch — die Post-Gruppe
 * vermerkt, die Mail-Gruppe eingereiht, wenn der Versand bereit ist. Was zurückliegt, liegt im Stichjahr: eine abgesagte außerordentliche
 * Versammlung auf Verlangen (§ 37 BGB) mit einem Antrag nach Frist, eine Vorstandssitzung mit Vermerk „Messenger“.
 */
async function seedMeetings(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: governanceMeetings.id }).from(governanceMeetings).get()) return;
  const organs = deps.db.select().from(governanceOrgans).all();
  const mv = organs.find((o) => o.kind === 'assembly');
  const board = organs.find((o) => o.kind === 'board');
  if (!mv || !board) return;
  const today = todayIn(deps);
  const y = seedStoryYear(today);
  const at = { startsAt: '19:00', form: 'inPerson' as const };

  // Verlangen einer außerordentlichen Versammlung, erreicht; die Versammlung wurde nach einem späten Antrag abgesagt.
  const request = unwrap(await saveAssemblyRequest(deps, ctx, { organId: mv.id, receivedOn: `${y}-04-02`, supporters: 12, purpose: 'Aussprache über den Umzug der Geschäftsstelle' }));
  const extraordinary = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'extraordinary', heldOn: `${y}-05-10`, ...at, place: 'Gemeindesaal', assemblyRequestId: request.id }));
  unwrap(await proposeAgenda(deps, ctx, { meetingId: extraordinary.id }));
  unwrap(await saveMotion(deps, ctx, { meetingId: extraordinary.id, receivedOn: `${y}-05-05`, text: 'Die Geschäftsstelle bleibt bis Jahresende am alten Ort.' }));
  unwrap(await cancelMeeting(deps, ctx, { id: extraordinary.id, cancelledOn: `${y}-05-06`, reason: 'Das Anliegen hat sich durch einen Vorstandsbeschluss erledigt.' }));

  // Vorstandssitzung, eingeladen per Messenger.
  const noted = unwrap(await createMeeting(deps, ctx, { organId: board.id, kind: 'board', heldOn: `${y}-08-20`, ...at, place: 'Geschäftsstelle' }));
  unwrap(await recordInvitationNote(deps, ctx, { meetingId: noted.id, invitedOn: `${y}-08-12`, note: 'Messenger' }));

  // Geplante Vorstandssitzung ohne Einladung (löschbar).
  unwrap(await createMeeting(deps, ctx, { organId: board.id, kind: 'board', heldOn: addCalendarDays(today, 14), ...at, form: 'hybrid', access: 'https://meet.example.org/vorstand', remoteNote: 'Teilnahme und Abstimmung über den Videoraum.' }));

  // Ordentliche Versammlung in 30 Tagen: Tagesordnung, ein rechtzeitiger Antrag, Einladungslauf ausgestellt.
  const ordinary = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'ordinary', heldOn: addCalendarDays(today, 30), ...at, place: 'Gemeindesaal' }));
  unwrap(await proposeAgenda(deps, ctx, { meetingId: ordinary.id }));
  unwrap(await saveMotion(deps, ctx, { meetingId: ordinary.id, receivedOn: today, text: 'Der Verein schafft einen zweiten Transportanhänger an.' }));
  const run = await startInvitationRun(deps, ctx, { meetingId: ordinary.id, kind: 'invitation' });
  if (!run.ok) return;
  // Fünf Briefe, der Lauf bleibt offen: Wer am Ausstellungstag Mitglied ist, hängt vom Tag ab (ein Austritt zum
  // Jahresende des Stichjahres) — die ersten fünf Nummern laufen das ganze Stichjahr, so erzählt der Seed an jedem Tag
  // dieselbe Geschichte (`seed-calendar.test.ts`).
  const state: InvitationRunView = unwrap(await continueInvitationRun(deps, ctx, { runId: run.value.id, max: 5 }));
  const dispatch = unwrap(await invitationDispatchState(deps, ctx, { runId: state.id }));
  if (dispatch.post.length > 0) unwrap(await markInvitationPostDispatched(deps, ctx, { runId: state.id, sentAt: today }));
  // Ohne bereiten Mailversand (Entwicklung ohne Absender) bleibt die Mail-Gruppe offen.
  await sendInvitationMails(deps, ctx, { runId: state.id });
}

/**
 * Block G3 (Plan G3 Task 9), nur ohne Beschluss und Umlauf: im Vorjahr die außerordentliche Versammlung der
 * Satzungsänderung (beendet, Protokoll offen), eine beschlussunfähige außerordentliche Versammlung zur Beitragsordnung
 * und ihre Wiederholung ohne Quorum, die sie beschließt (beide beendet); im Stichjahr eine laufende Vorstandssitzung mit erfasstem, nicht festgestelltem
 * Beschluss und zwei Umläufe des Vorstands — einer kam zustande, einer scheiterte an einer Ablehnung. Alle Tage
 * vergangen; der Mitlauf beginnt „jetzt“.
 */
async function seedMinutes(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: governanceResolutions.id }).from(governanceResolutions).get() || deps.db.select({ id: governanceCirculars.id }).from(governanceCirculars).get()) return;
  const organs = deps.db.select().from(governanceOrgans).all();
  const mv = organs.find((o) => o.kind === 'assembly');
  const board = organs.find((o) => o.kind === 'board');
  if (!mv || !board) return;
  const y = seedStoryYear(todayIn(deps));
  const at = { startsAt: '19:00', form: 'inPerson' as const };

  /** Beginnen, vorbelegen, die ersten `present` (alle ohne Angabe) kommen um 19:00. */
  const open = async (meetingId: string, present?: number) => {
    unwrap(await startMeeting(onMeetingDay(deps, meetingId), ctx, { meetingId }));
    const rows = unwrap(await prefillAttendance(deps, ctx, { meetingId }));
    for (const row of rows.slice(0, present ?? rows.length)) unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
    return rows;
  };

  // Außerordentliche Versammlung der Satzungsänderung des Vorjahres.
  const amendment = deps.db.select().from(governanceStatutes).all().find((st) => st.resolutions.some((r) => r.on === `${y - 1}-03-20`));
  const extraordinary = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'extraordinary', heldOn: `${y - 1}-03-20`, ...at, place: 'Gemeindesaal' }));
  const statuteItem = unwrap(await saveAgendaItem(deps, ctx, { meetingId: extraordinary.id, kind: 'statute', title: 'Änderung der Satzung: Antragsfrist und Wahlverfahren', statuteId: amendment?.id ?? null }));
  const auditorOffice = deps.db.select().from(governanceOffices).where(eq(governanceOffices.function, 'auditor')).get();
  const auditorItem = auditorOffice ? unwrap(await saveAgendaItem(deps, ctx, { meetingId: extraordinary.id, kind: 'election', title: 'Wahl der Kassenprüfung', officeIds: [auditorOffice.id] })) : null;
  const present = await open(extraordinary.id);
  unwrap(await saveFindings(deps, ctx, { meetingId: extraordinary.id, findings: { invitationProper: true, invitationNote: 'Einladung per E-Mail und Brief, Frist gewahrt.', agendaApproved: true } }));
  unwrap(await setAgendaNote(deps, ctx, { itemId: statuteItem.id, note: 'Der Vorstand stellte die Änderungen vor. Gefragt wurde, ob die neue Antragsfrist auch für Anträge aus dem Vorstand gilt; das wurde bejaht.' }));
  const statute = unwrap(await saveResolution(deps, ctx, { agendaItemId: statuteItem.id, text: 'Die Versammlung beschließt die Neufassung von § 9 und § 12 der Satzung.', votedAt: '19:30', unanimous: true }));
  unwrap(await decideResolution(deps, ctx, { id: statute.id, outcome: 'adopted' }));
  // Die Kassenprüfung, die seither nachgetragen im Amt ist: Das Festschreiben (Block G4) gleicht ab, statt zu doppeln.
  const auditors = auditorOffice ? deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, auditorOffice.id)).all().filter((t) => t.since === `${y - 1}-03-20`) : [];
  if (auditorItem && auditorOffice && auditors.length > 0 && present.length > 0) {
    unwrap(await setAgendaNote(deps, ctx, { itemId: auditorItem.id, note: 'Beide Kandidierenden stellten sich kurz vor. Weitere Vorschläge kamen aus der Versammlung nicht.' }));
    const round = { number: 1, runoff: false, candidates: auditors.map((t) => ({ contactId: t.contactId, votes: present.length })), no: 0, abstain: 0, invalid: 0, unanimousContactId: null };
    const election = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: auditorItem.id, officeId: auditorOffice.id, votedAt: '19:45', round }));
    for (const t of auditors) unwrap(await acceptElection(deps, ctx, { resolutionId: election.id, contactId: t.contactId }));
  }
  unwrap(await endMeeting(deps, ctx, { meetingId: extraordinary.id, endedAt: '20:15' }));

  // Außerordentliche Versammlung zur Beitragsordnung ohne Quorum (eine Person erschienen), dann die Wiederholung ohne
  // Quorum: Sie beschließt die Beitragsordnung ab dem 1. Januar des Stichjahres (Mitglieder: `resolvedOn`, V-2).
  const inquorate = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'extraordinary', heldOn: `${y - 1}-05-10`, ...at, place: 'Gemeindesaal' }));
  await open(inquorate.id, 1);
  unwrap(await saveFindings(deps, ctx, { meetingId: inquorate.id, findings: { quorate: false } }));
  unwrap(await endMeeting(deps, ctx, { meetingId: inquorate.id, endedAt: '19:20' }));
  const repeat = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'repeat', repeatOfId: inquorate.id, heldOn: `${y - 1}-06-05`, ...at, place: 'Gemeindesaal' }));
  const fees = unwrap(await saveAgendaItem(deps, ctx, { meetingId: repeat.id, kind: 'feeSchedule', title: `Beitragsordnung ab 1. Januar ${y}` }));
  await open(repeat.id, 2);
  const schedule = deps.db.select({ id: memberFeeSchedules.id }).from(memberFeeSchedules).where(eq(memberFeeSchedules.validFrom, `${y}-01-01`)).get();
  const feeResolution = unwrap(await saveResolution(deps, ctx, { agendaItemId: fees.id, text: `Die Versammlung beschließt die Beitragsordnung ab 1. Januar ${y}.`, votedAt: '19:40', unanimous: true, details: { feeScheduleId: schedule?.id ?? null } }));
  unwrap(await decideResolution(deps, ctx, { id: feeResolution.id, outcome: 'adopted' }));
  unwrap(await endMeeting(deps, ctx, { meetingId: repeat.id, endedAt: '20:00' }));

  // Laufende Vorstandssitzung im Stichjahr: zwei Wochen vorher per E-Mail eingeladen, am Sitzungstag begonnen, Leitung (Vorsitz) und
  // Protokoll (Stellvertretung) bestimmt, ordnungsgemäß eingeladen und beschlussfähig; ein Beschluss erfasst, noch nicht festgestellt.
  const running = unwrap(await createMeeting(deps, ctx, { organId: board.id, kind: 'board', heldOn: `${y}-07-15`, ...at, place: 'Geschäftsstelle' }));
  const purchase = unwrap(await saveAgendaItem(deps, ctx, { meetingId: running.id, kind: 'simple', title: 'Anschaffung eines Transportanhängers' }));
  unwrap(await recordInvitationNote(deps, ctx, { meetingId: running.id, invitedOn: `${y}-07-01`, note: 'E-Mail' }));
  await open(running.id);
  const holderOn = (fn: OfficeFunction, day: string) => {
    const officeId = deps.db.select().from(governanceOffices).where(eq(governanceOffices.function, fn)).get()?.id;
    return deps.db.select().from(governanceTerms).all().find((t) => t.officeId === officeId && t.since <= day && (t.until === null || t.until >= day))?.contactId ?? null;
  };
  unwrap(await saveFindings(deps, ctx, { meetingId: running.id, findings: { invitationProper: true, quorate: true, chairContactId: holderOn('chair', `${y}-07-15`), minuteTakerContactId: holderOn('board', `${y}-07-15`), chairBy: 'statute', agendaApproved: true } }));
  unwrap(await saveResolution(deps, ctx, { agendaItemId: purchase.id, text: 'Der Vorstand beschafft einen Transportanhänger bis 2.500 Euro.', votedAt: '19:25', votes: { yes: 2, no: 0, abstain: 1, invalid: 0 } }));

  // Zwei Umläufe des Vorstands (BGB: Zustimmung aller in Textform).
  const answerAll = async (circularId: string, answers: ('yes' | 'no')[], answeredOn: string) => {
    const view = unwrap(await getCircular(deps, ctx, { id: circularId }));
    for (const [i, r] of view.responses.entries()) unwrap(await saveCircularResponse(deps, ctx, { id: r.id, answer: answers[i] ?? 'yes', answeredOn, ...(i === 0 ? { note: 'Zustimmung per Messenger.' } : {}) }));
  };
  const chairId = deps.db.select().from(governanceOffices).where(eq(governanceOffices.function, 'chair')).get()?.id;
  const chair = chairId ? deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, chairId)).get()?.contactId : undefined;
  if (!chair) return;
  const agreed = unwrap(await createCircular(deps, ctx, { organId: board.id, kind: 'simple', text: 'Der Vorstand verlängert den Vertrag für den Lagerraum um ein Jahr.', requestedOn: `${y}-07-01`, deadline: `${y}-07-08`, channel: 'email' }));
  await answerAll(agreed.id, ['yes', 'yes', 'yes'], `${y}-07-03`);
  unwrap(await decideCircular(deps, ctx, { id: agreed.id, outcome: 'adopted', decidedOn: `${y}-07-09`, decidedByContactId: chair }));
  const failed = unwrap(await createCircular(deps, ctx, { organId: board.id, kind: 'simple', text: 'Der Vorstand tritt dem Landesverband bei.', requestedOn: `${y}-08-01`, deadline: `${y}-08-08`, channel: 'messenger' }));
  await answerAll(failed.id, ['yes', 'no', 'yes'], `${y}-08-04`);
  unwrap(await decideCircular(deps, ctx, { id: failed.id, outcome: 'rejected', decidedOn: `${y}-08-10`, decidedByContactId: chair }));
}

/**
 * Block G4 (Plan G4 Task 9), nur ohne festgeschriebene Sitzung: die Gründungsversammlung im ältesten abgeschlossenen
 * Jahr nachgetragen und festgeschrieben (Gründungsstand abgeglichen, Gründer, ein überfälliger Auftrag, Anlass
 * `initial`); die außerordentliche Versammlung des Vorjahres festgeschrieben (Satzungsänderung am eingetragenen Stand,
 * Kassenprüfung abgeglichen) und die Wiederholungsversammlung mit der Beitragsordnung (die Mitglieder verweisen
 * darauf); der zustande gekommene Umlauf und ein Umlauf mit Auftrag (Wiedervorlage in 60 Tagen) festgeschrieben; die
 * ordentlichen Versammlungen im März des Vorjahres und des Stichjahres mit Jahresrechnung und Entlastung (im Stichjahr
 * dazu Vergütung und Rücklage, auf die die freie Rücklage verweist); eine Vorstandssitzung im Juni des Stichjahres
 * beendet, ohne unterschriebenes Protokoll — älter als vier Wochen an jedem Tag des Stichjahres.
 */
async function seedSealing(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: governanceMeetings.id }).from(governanceMeetings).where(isNotNull(governanceMeetings.sealedAt)).get()) return;
  if (deps.db.select({ kind: governanceMeetings.kind }).from(governanceMeetings).all().some((m) => m.kind === 'founding')) return;
  const organs = deps.db.select().from(governanceOrgans).all();
  const mv = organs.find((o) => o.kind === 'assembly');
  const board = organs.find((o) => o.kind === 'board');
  if (!mv || !board) return;
  const today = todayIn(deps);
  const y = seedStoryYear(today);
  const founded = y - SEED_CLOSED_YEARS;
  const officeOf = (fn: OfficeFunction) => deps.db.select().from(governanceOffices).where(eq(governanceOffices.function, fn)).get();
  const holderOf = (fn: OfficeFunction) => {
    const office = officeOf(fn);
    return office ? deps.db.select().from(governanceTerms).where(eq(governanceTerms.officeId, office.id)).all().find((t) => t.until === null)?.contactId : undefined;
  };
  // Das unterschriebene Protokoll liegt am Abend der Sitzung in der Akte (Ablagezeit passend zum Datum, `seedClockAt`).
  const sign = async (meetingId: string, line: string) => {
    const heldOn = deps.db.select({ heldOn: governanceMeetings.heldOn }).from(governanceMeetings).where(eq(governanceMeetings.id, meetingId)).get()!.heldOn;
    unwrap(await fileSignedMinutes(seedClockAt(deps, seedMoment(deps, heldOn, '21:00')), ctx, { meetingId, bytes: textPdf([line]) }));
  };

  // Gründungsversammlung, nachgetragen (Spec § 5.7): Leitung mit Einverständnis aller, Satzung 7/0/0 nach BGB.
  const foundingStand = deps.db.select().from(governanceStatutes).all().find((st) => st.resolutions.some((r) => r.on === `${founded}-02-10`));
  // Leitung und Protokoll der Gründung: Stellvertretung und späterer Vorsitz (V-2, wie Finanzen und Kontakte).
  const named = (p: Person) => deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, p.firstName), eq(contacts.lastName, p.lastName))).get()?.id;
  const [chair, deputy] = [named(PEOPLE.deputy), named(PEOPLE.chairBefore)];
  let founderMandate: string | null = null;
  if (foundingStand && chair && deputy) {
    const founding = unwrap(await backfillMeeting(deps, ctx, { organId: mv.id, kind: 'founding', heldOn: `${founded}-02-10`, startsAt: '18:00', endedAt: '19:45', form: 'inPerson', place: 'Gemeindesaal', present: 7, voting: 7, chairContactId: chair, minuteTakerContactId: deputy, chairBy: 'consent' }));
    const statuteItem = unwrap(await saveAgendaItem(deps, ctx, { meetingId: founding.id, kind: 'statute', title: 'Beschluss über die Satzung', statuteId: foundingStand.id }));
    const statute = unwrap(await saveResolution(deps, ctx, { agendaItemId: statuteItem.id, text: 'Die Versammlung beschließt die vorliegende Satzung und gründet den Verein.', votedAt: '18:20', votes: { yes: 7, no: 0, abstain: 0 } }));
    unwrap(await decideResolution(deps, ctx, { id: statute.id, outcome: 'adopted' }));
    unwrap(await setAgendaNote(deps, ctx, { itemId: statuteItem.id, note: 'Der Entwurf der Satzung lag allen Anwesenden vor und wurde Paragraf für Paragraf verlesen.' }));
    const mandateItem = unwrap(await saveAgendaItem(deps, ctx, { meetingId: founding.id, kind: 'mandate', title: 'Anmeldung zum Vereinsregister' }));
    const mandate = unwrap(await saveResolution(deps, ctx, { agendaItemId: mandateItem.id, text: 'Der Vorstand meldet den Verein zum Vereinsregister an.', votedAt: '19:30', unanimous: true, details: { organId: board.id, officeId: null, dueOn: `${founded}-03-15`, task: 'Anmeldung beim Notar vorbereiten' } }));
    unwrap(await decideResolution(deps, ctx, { id: mandate.id, outcome: 'adopted' }));
    founderMandate = mandate.id;
    for (const contactId of [chair, deputy]) unwrap(await saveAttendance(deps, ctx, { meetingId: founding.id, contactId, role: 'founder' }));
    await sign(founding.id, 'Protokoll der Gründungsversammlung (unterschrieben)');
    unwrap(await sealMeeting(deps, ctx, { meetingId: founding.id }));
    // Der Auftrag ist längst erledigt: Die Anmeldung ging am 26.02. ein (Block G5) — die Wiedervorlage ist abgehakt.
    const doneAt = seedClockAt(deps, seedMoment(deps, `${founded}-02-26`, '10:00'));
    deps.db.transaction((tx) => completeFollowUpsInternal(tx, doneAt, ctx, { entityType: 'governanceResolution', entityId: founderMandate! }));
  }

  // Die Versammlungen des Vorjahres aus Block G3: festschreiben, was beendet ist — auch die beschlussunfähige
  // (ihr Protokoll hält fest, dass nichts beschlossen wurde); kein Protokoll aus dem Vorjahr bleibt offen.
  const all = deps.db.select().from(governanceMeetings).all();
  for (const meeting of all.filter((m) => m.organId === mv.id && (m.kind === 'extraordinary' || m.kind === 'repeat') && m.heldOn.startsWith(`${y - 1}-`) && m.endedAt && !m.sealedAt).sort((a, b) => a.heldOn.localeCompare(b.heldOn))) {
    await sign(meeting.id, `Protokoll vom ${paperDate(isoDay(meeting.heldOn))} (unterschrieben)`);
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
  }

  // Die Beitragsordnung der Mitglieder verweist auf den Beschluss der Wiederholungsversammlung (V-2).
  const feeResolution = deps.db.select().from(governanceResolutions).all().find((r) => r.kind === 'feeSchedule' && r.number !== null);
  const schedule = feeResolution ? unwrap(await listFeeSchedules(deps, ctx, {})).find((sc) => sc.validFrom === `${y}-01-01`) : undefined;
  if (feeResolution && schedule && schedule.resolutionId === null) {
    const rules = schedule.rules.map((r) => ({ typeId: r.typeId, amountCents: r.amountCents, interval: r.interval, minimum: r.minimum, allowedIntervals: r.allowedIntervals, admissionFeeCents: r.admissionFeeCents }));
    unwrap(await saveFeeSchedule(deps, ctx, { id: schedule.id, validFrom: schedule.validFrom, resolvedOn: schedule.resolvedOn, resolutionDocumentId: schedule.resolutionDocumentId, resolutionId: feeResolution.id, note: schedule.note, rules }));
  }

  // Der zustande gekommene Umlauf und ein Auftrag im Umlauf (Wiedervorlage in 60 Tagen).
  const agreed = deps.db.select().from(governanceCirculars).all().find((c) => c.outcome === 'adopted' && !c.sealedAt);
  if (agreed) unwrap(await sealCircular(deps, ctx, { circularId: agreed.id }));
  const treasurer = officeOf('treasurer');
  const chairNow = holderOf('chair');
  if (treasurer && chairNow) {
    const mandate = unwrap(await createCircular(deps, ctx, { organId: board.id, kind: 'mandate', text: 'Die Kasse holt drei Angebote für eine Vereinshaftpflicht ein.', details: { organId: null, officeId: treasurer.id, dueOn: addCalendarDays(today, 60), task: 'Angebote einholen' }, requestedOn: `${y}-08-10`, deadline: `${y}-08-17`, channel: 'email' }));
    const view = unwrap(await getCircular(deps, ctx, { id: mandate.id }));
    for (const r of view.responses) unwrap(await saveCircularResponse(deps, ctx, { id: r.id, answer: 'yes', answeredOn: `${y}-08-12` }));
    unwrap(await decideCircular(deps, ctx, { id: mandate.id, outcome: 'adopted', decidedOn: `${y}-08-18`, decidedByContactId: chairNow }));
    unwrap(await sealCircular(deps, ctx, { circularId: mandate.id }));
  }

  // Ordentliche Versammlungen im März (G7, V-2): Jahresrechnung des Vorjahres genehmigt, Vorstand einzeln entlastet — alle,
  // die die Finanzen für das Jahr nennen. Festgeschrieben; Schritt 11 der Finanzen liest sie. Nur mit Geschäftsjahr. Im
  // Stichjahr dazu die Vergütung der Beisitzerin und die Zuführung zur freien Rücklage, auf die die Rücklage verweist.
  const fiscalYear = (designation: number) => deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.designation, String(designation))).get();
  type Extra = { kind: 'remuneration' | 'reserve'; title: string; text: string; votedAt: string; details: unknown };
  const annualAssembly = async (heldOn: string, year: NonNullable<ReturnType<typeof fiscalYear>>, extras: Extra[] = []) => {
    const ordinary = unwrap(await createMeeting(deps, ctx, { organId: mv.id, kind: 'ordinary', heldOn, startsAt: '19:00', form: 'inPerson', place: 'Gemeindesaal' }));
    const accountsItem = unwrap(await saveAgendaItem(deps, ctx, { meetingId: ordinary.id, kind: 'accounts', title: `Jahresrechnung ${year.designation}` }));
    const dischargeItem = unwrap(await saveAgendaItem(deps, ctx, { meetingId: ordinary.id, kind: 'discharge', title: 'Entlastung des Vorstands' }));
    const extraItems = [];
    for (const e of extras) extraItems.push({ e, item: unwrap(await saveAgendaItem(deps, ctx, { meetingId: ordinary.id, kind: e.kind, title: e.title })) });
    unwrap(await startMeeting(onMeetingDay(deps, ordinary.id), ctx, { meetingId: ordinary.id }));
    for (const row of unwrap(await prefillAttendance(deps, ctx, { meetingId: ordinary.id }))) unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
    const accounts = unwrap(await saveResolution(deps, ctx, { agendaItemId: accountsItem.id, text: `Die Versammlung genehmigt die Jahresrechnung ${year.designation}.`, votedAt: '19:20', unanimous: true, details: { fiscalYearId: year.id } }));
    unwrap(await decideResolution(deps, ctx, { id: accounts.id, outcome: 'adopted' }));
    for (const r of unwrap(await saveDischarge(deps, ctx, { agendaItemId: dischargeItem.id, fiscalYearId: year.id, mode: 'individual', votedAt: '19:30', unanimous: true }))) {
      unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    }
    for (const { e, item } of extraItems) {
      const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: item.id, text: e.text, votedAt: e.votedAt, unanimous: true, details: e.details }));
      unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    }
    unwrap(await endMeeting(deps, ctx, { meetingId: ordinary.id, endedAt: '20:30' }));
    await sign(ordinary.id, `Protokoll vom ${paperDate(isoDay(heldOn))} (unterschrieben)`);
    unwrap(await sealMeeting(deps, ctx, { meetingId: ordinary.id }));
  };
  const twoYearsBack = fiscalYear(y - 2);
  if (twoYearsBack) await annualAssembly(`${y - 1}-03-14`, twoYearsBack);
  const previousYear = fiscalYear(y - 1);
  const storyFiscalYear = fiscalYear(y);
  const assessor = deps.db.select().from(governanceOffices).all().find((o) => o.name === 'Beisitz');
  const freeReserve = deps.db.select().from(financeReserves).where(eq(financeReserves.name, 'Freie Rücklage')).get();
  if (previousYear) {
    const extras: Extra[] = [];
    if (assessor) extras.push({ kind: 'remuneration', title: 'Ehrenamtspauschale der Beisitzerin', text: 'Die Versammlung beschließt eine Ehrenamtspauschale für den Beisitz.', votedAt: '19:45', details: { statuteReference: '§ 7 Abs. 5 Satzung', decidedByOrganId: mv.id, officeIds: [assessor.id], mode: 'flat', amountCents: 84000, validFrom: `${y}-04-01` } });
    if (storyFiscalYear && freeReserve) {
      const movement = deps.db.select().from(financeReserveMovements).where(eq(financeReserveMovements.reserveId, freeReserve.id)).all().find((m) => m.forFiscalYearId === storyFiscalYear.id);
      extras.push({ kind: 'reserve', title: 'Zuführung zur freien Rücklage', text: 'Die Versammlung beschließt eine Zuführung zur freien Rücklage.', votedAt: '19:55', details: { type: 'nr3', purpose: null, amountCents: movement?.amountCents ?? 100000, fiscalYearId: storyFiscalYear.id, action: 'create' } });
    }
    await annualAssembly(`${y}-03-14`, previousYear, extras);
  }
  // Die Mitgliederversammlung genehmigt die Jahresrechnung (festgeschriebene Beschlüsse oben): Die Finanzen stellen sie
  // passend dazu erst nach diesem Beschluss bereit (`finance.reports.assemblyApprovesAccounts`, V-4) — sonst warnt die
  // Übersicht der Gremien. Nach den Veröffentlichungen des Finanz-Seeds gesetzt, die ihm vorausgehen.
  const approved = deps.db.select().from(governanceResolutions).all().some((r) => r.kind === 'accounts' && r.outcome === 'adopted' && r.number !== null);
  if (approved) deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'finance.reports.assemblyApprovesAccounts', true, 'finance.setup.setting'));

  // Die freie Rücklage verweist auf den festgeschriebenen Beschluss (V-2, Spec § 8.1).
  const reserveResolution = deps.db.select().from(governanceResolutions).all().find((r) => r.kind === 'reserve' && r.number !== null);
  if (reserveResolution && freeReserve && freeReserve.resolutionId === null) unwrap(await linkResolution(deps, ctx, { id: freeReserve.id, field: 'resolutionId', resolutionId: reserveResolution.id }));

  // Vorstandssitzung im Juni, beendet, ohne unterschriebenes Protokoll (Frist „Protokoll offen“).
  const june = unwrap(await createMeeting(deps, ctx, { organId: board.id, kind: 'board', heldOn: `${y}-06-10`, startsAt: '19:00', form: 'virtual', remoteNote: 'Videoraum des Vereins.' }));
  const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: june.id, kind: 'simple', title: 'Sommerfest' }));
  unwrap(await startMeeting(onMeetingDay(deps, june.id), ctx, { meetingId: june.id }));
  for (const row of unwrap(await prefillAttendance(deps, ctx, { meetingId: june.id }))) unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
  const party = unwrap(await saveResolution(deps, ctx, { agendaItemId: item.id, text: 'Der Verein richtet im August ein Sommerfest aus.', votedAt: '19:20', unanimous: true }));
  unwrap(await decideResolution(deps, ctx, { id: party.id, outcome: 'adopted' }));
  unwrap(await endMeeting(deps, ctx, { meetingId: june.id, endedAt: '20:00' }));
}

/** Die Uhr am Beginn der Sitzung (Tag und Uhrzeit): Der Mitlauf beginnt am Sitzungstag, nicht am Tag des Seeds (G-25). */
function onMeetingDay(deps: Deps, meetingId: string): Deps {
  const m = deps.db.select({ heldOn: governanceMeetings.heldOn, startsAt: governanceMeetings.startsAt }).from(governanceMeetings).where(eq(governanceMeetings.id, meetingId)).get()!;
  return seedClockAt(deps, seedMoment(deps, m.heldOn, m.startsAt));
}

/** Erfundene Registerdaten (wie der Kern-Seed): Gericht und Nummer gibt es nicht. */
const SEED_COURT = 'Amtsgericht Musterstadt';
const SEED_NUMBER = 'VR 4711';

/**
 * Block G5 (Plan G5 Task 7), nur ohne Registeranmeldung: die Ersteintragung im ältesten abgeschlossenen Jahr aus dem
 * Anlass `initial` des Blocks G4 — beim Notar, eingereicht, eine Zwischenverfügung ohne Frist, eingetragen am Tag, den
 * der Gründungsstand (Block G1) trägt —; die Satzungsänderung des Vorjahres eingetragen am Tag ihres Stands; der Wechsel
 * der Kasse im Stichjahr (Rücktritt und Ersatzbestellung) als fällige Anmeldung — längst nicht mehr unverzüglich (Frage 1 berechnet); die Meldung zum Transparenzregister zählt erst ab der Einreichung (0.5.0 Nr. 6). Die Eintragung
 * läuft über `completeRegisterFiling` mit denselben Tagen: Sie trägt die Stände erneut am selben Tag ein und setzt den
 * Tag der Ersteintragung im Vereinsstamm. Der beschlossene Stand des Stichjahres hat keinen Anlass (von Hand
 * nachgetragen, ohne Beschluss einer Sitzung) und bleibt ohne Anmeldung.
 */
async function seedRegister(deps: Deps, ctx: CallContext): Promise<void> {
  if (deps.db.select({ id: governanceRegisterFilings.id }).from(governanceRegisterFilings).get()) return;
  const y = seedStoryYear(todayIn(deps));
  const founded = y - SEED_CLOSED_YEARS;
  const occasions = deps.db.select().from(governanceRegisterOccasions).all().filter((o) => o.filingId === null);
  const initial = occasions.find((o) => o.kind === 'initial');
  if (initial) {
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: initial.id }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: `${founded}-02-24`, submittedOn: `${founded}-02-26` }));
    unwrap(await recordInterimOrder(deps, ctx, { filingId: filing.id, on: `${founded}-03-18` }));
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: `${founded}-04-20`, registerCourt: SEED_COURT, registerNumber: SEED_NUMBER }));
  }
  const amendment = occasions.find((o) => o.kind === 'statute' && o.occurredOn === `${y - 1}-03-20`);
  if (amendment) {
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: amendment.id }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: `${y - 1}-04-08`, submittedOn: `${y - 1}-04-10` }));
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: `${y - 1}-06-01` }));
  }
  const treasurerChange = occasions.filter((o) => o.kind === 'boardChange' && o.occurredOn.startsWith(`${y}-`));
  if (treasurerChange.length > 0) unwrap(await createRegisterFiling(deps, ctx, { occasions: treasurerChange.map((o) => ({ id: o.id })) }));
}
