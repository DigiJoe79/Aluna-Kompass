import { EMPTY, paperDate, isoDay, recordAudit, requirePermission, ok, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { issueGeneratedDocument } from '@kompass/module-dms';
import { memberMemberships } from '@kompass/module-members';
import { addCalendarDays } from '@kompass/module-finance';
import { and, asc, eq } from 'drizzle-orm';
import { attendanceOfInternal } from '../attendance';
import { governanceConflict } from '../errors';
import { day, meetingTitle } from '../invitation/words';
import type { ElectionDetails } from '../resolution-details';
import { resolveRule } from '../rules/resolve';
import { referenceOf } from '../rules/words';
import { governanceAgendaItems, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type AttendancePeriod, type MeetingRow } from '../schema';
import { statuteRulesOnInternal } from '../statutes';
import { termRunsOn, termScheduledEnd } from '../term-schedule';
import { ATTACHMENT_WORDS, ATTENDANCE_LIST_TEMPLATE_KEY, REGISTER_DATA_TEMPLATE_KEY, type AttendanceListInput, type RegisterDataInput } from './attachment-templates';
import { contactNameInternal } from './compose';
import { minutesMeetingSchema, recordedMeetingInternal } from './print';

function meetingLine(db: DbOrTx, meeting: MeetingRow): string {
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, meeting.organId)).get()!;
  return `${meetingTitle(meeting.kind, organ.name)} am ${day(meeting.heldOn)}`;
}

/** „Nachname, Vorname“ einer Person, sonst der Anzeigename; gelöschte Kontakte ohne Namen. */
function listName(db: DbOrTx, contactId: string | null): string {
  if (!contactId) return '';
  const c = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!c) return contactNameInternal(db, contactId) ?? '';
  return c.kind === 'person' && c.lastName ? [c.lastName, c.firstName].filter(Boolean).join(', ') : displayName(c);
}

/**
 * Höchststand der gleichzeitig Anwesenden aus den Zeiträumen je Person (Plan U2): Gehen und Kommen in derselben
 * Minute zählen nicht doppelt — das Gehen wird zuerst gezählt. Bei gleichem Stand gilt die frühere Uhrzeit.
 */
export function peakInternal(people: AttendancePeriod[][]): { count: number; at: string | null } {
  const events = people.flatMap((periods) => periods.flatMap((p) => [{ at: p.from, d: 1 }, ...(p.to ? [{ at: p.to, d: -1 }] : [])]));
  events.sort((a, b) => a.at.localeCompare(b.at) || a.d - b.d);
  let now = 0;
  let best = { count: 0, at: null as string | null };
  for (const e of events) {
    now += e.d;
    if (now > best.count) best = { count: now, at: e.at };
  }
  return best;
}

/** Die Anwesenheitsliste als Anlage (Board 11e): Nr., Name, Stimmrecht, Kommt, Geht, Unterschrift — keine Anschriften. */
export function attendanceListInputInternal(db: DbOrTx, meeting: MeetingRow): AttendanceListInput {
  const present = attendanceOfInternal(db, meeting.id).filter((r) => r.periods.length > 0);
  const named = present.map((r) => ({ row: r, name: r.guest ? (r.guestLabel ?? ATTACHMENT_WORDS.guest) : listName(db, r.contactId) }));
  named.sort((a, b) => Number(a.row.guest) - Number(b.row.guest) || a.name.localeCompare(b.name, 'de'));
  const rows = named.map(({ row, name }, i) => ({
    no: i + 1,
    name,
    voting: row.guest ? ATTACHMENT_WORDS.guest : ATTACHMENT_WORDS.voting(row.votingRight),
    arrivals: row.periods.map((p) => p.from).join('\n'),
    departures: row.periods.map((p) => p.to ?? '').filter((t) => t !== '').join('\n'),
  }));
  const voting = present.filter((r) => !r.guest && r.votingRight);
  const peak = peakInternal(voting.map((r) => r.periods));
  return { title: ATTACHMENT_WORDS.attendanceTitle, meeting: meetingLine(db, meeting), rows, summary: ATTACHMENT_WORDS.summary(voting.length, present.filter((r) => !r.guest && !r.votingRight).length, present.filter((r) => r.guest).length, peak.count, peak.at) };
}

/** Geburtsdatum der jüngsten Mitgliedschaft des Kontakts — Gremien speichert es nicht (Spec § 5.5). */
function birthDateOf(db: DbOrTx, contactId: string): string | null {
  const rows = db.select().from(memberMemberships).where(eq(memberMemberships.contactId, contactId)).all();
  const latest = rows.sort((a, b) => `${b.joinedOn ?? b.appliedOn ?? ''}|${b.createdAt}`.localeCompare(`${a.joinedOn ?? a.appliedOn ?? ''}|${a.createdAt}`))[0];
  return latest?.birthDate ?? null;
}

/**
 * Angaben für die notarielle Anmeldung (Board 11f, § 67 BGB), nicht fürs Protokoll: je in dieser Sitzung gewählter Person
 * eines vertretenden Amts mit Annahme eine Zeile `new` mit Geburtsdatum (fehlt es, eine Leerzeile) und Wohnort; die
 * Ausgeschiedenen desselben Amts (am Vortag der Annahme im Amt, nicht wiedergewählt) als `left` mit „—“. Dazu der Satz
 * zur Vertretung mit den Unterschreibenden (**Claude**: bei `two` die ersten zwei nach Amtsreihenfolge, `single` die
 * erste, `all` alle, `majority` die Mehrheit).
 */
export function registerDataInputInternal(db: DbOrTx, meeting: MeetingRow): RegisterDataInput {
  const elections = db.select().from(governanceResolutions).where(and(eq(governanceResolutions.meetingId, meeting.id), eq(governanceResolutions.kind, 'election'))).all();
  const rows: RegisterDataInput['rows'] = [];
  const changed: string[] = [];
  const leaving = new Set<string>();
  const joining: { officeId: string; contactId: string }[] = [];
  for (const row of elections.sort((a, b) => `${a.votedAt}|${a.createdAt}`.localeCompare(`${b.votedAt}|${b.createdAt}`))) {
    const details = row.details as ElectionDetails;
    const office = db.select().from(governanceOffices).where(eq(governanceOffices.id, details.officeId)).get();
    if (!office?.representative) continue;
    const accepted = details.elected.filter((x) => x.acceptedOn && !x.declinedOn);
    const newcomers: typeof accepted = [];
    for (const e of accepted) {
      const contact = db.select().from(contacts).where(eq(contacts.id, e.contactId)).get();
      if (!contact) continue;
      const birthDate = birthDateOf(db, e.contactId);
      rows.push({ name: listName(db, e.contactId), office: office.name, status: 'new', birthDate: birthDate ? paperDate(isoDay(birthDate)) : ATTACHMENT_WORDS.blank, city: contact.city?.trim() || ATTACHMENT_WORDS.blank });
      joining.push({ officeId: office.id, contactId: e.contactId });
      newcomers.push(e);
    }
    if (accepted.length > 0 && !changed.includes(office.name)) changed.push(office.name);
    const firstAccepted = accepted.map((e) => e.acceptedOn!).sort()[0];
    if (!firstAccepted) continue;
    const dayBefore = addCalendarDays(firstAccepted, -1);
    const electedIds = new Set(accepted.map((e) => e.contactId));
    const previous = db
      .select()
      .from(governanceTerms)
      .where(eq(governanceTerms.officeId, office.id))
      .all()
      .filter((t) => termRunsOn(t, office, dayBefore) && !electedIds.has(t.contactId))
      .sort((a, b) => (termScheduledEnd(a, office) ?? '9999').localeCompare(termScheduledEnd(b, office) ?? '9999'))
      .slice(0, newcomers.length);
    for (const t of previous) {
      leaving.add(t.id);
      rows.push({ name: listName(db, t.contactId), office: office.name, status: 'left', birthDate: EMPTY, city: EMPTY });
    }
  }
  const items = db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, meeting.id)).all();
  const statutePositions = items.filter((i) => i.kind === 'statute' || i.kind === 'purpose').map((i) => i.position).sort((a, b) => a - b);
  const changes = [...changed.map(ATTACHMENT_WORDS.changeOffice), ...(statutePositions.length ? [ATTACHMENT_WORDS.changeStatute(statutePositions)] : [])].join('; ');
  // Vertretung nach der Wahl: Inhaber der vertretenden Vorstandsämter am Sitzungstag ohne Ausgeschiedene, dazu die Neuen.
  const board = db.select().from(governanceOrgans).where(eq(governanceOrgans.kind, 'board')).get();
  let representation = '';
  if (board) {
    const rule = resolveRule(statuteRulesOnInternal(db, meeting.heldOn).rules, board.id, 'representation');
    const offices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, board.id)).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all().filter((o) => o.representative && o.active);
    const holders: string[] = [];
    for (const o of offices) {
      const newOnes = joining.filter((j) => j.officeId === o.id).map((j) => j.contactId);
      const stay = db.select().from(governanceTerms).where(eq(governanceTerms.officeId, o.id)).all().filter((t) => termRunsOn(t, o, meeting.heldOn) && !leaving.has(t.id)).map((t) => t.contactId);
      for (const c of [...stay, ...newOnes]) if (!holders.includes(c)) holders.push(c);
    }
    const mode = rule.value?.mode ?? 'majority';
    const count = mode === 'single' ? 1 : mode === 'two' ? 2 : mode === 'all' ? holders.length : Math.floor(holders.length / 2) + 1;
    const names = holders.slice(0, count).map((c) => contactNameInternal(db, c) ?? '');
    representation = ATTACHMENT_WORDS.representation(referenceOf(rule), ATTACHMENT_WORDS.representationWords[mode], names);
  }
  return { title: ATTACHMENT_WORDS.registerTitle, meeting: meetingLine(db, meeting), note: ATTACHMENT_WORDS.registerNote, occasion: ATTACHMENT_WORDS.occasion(meetingLine(db, meeting)), changes, rows, representation };
}

async function load(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MeetingRow>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, minutesMeetingSchema, input);
  if (!parsed.ok) return parsed;
  return recordedMeetingInternal(deps, parsed.value.meetingId);
}

/**
 * `governance.manage`: die Anwesenheitsliste als Dokument der Akte (`ANW`, 10 Jahre) an der Sitzung ausstellen. Ein
 * zweites Ausstellen erzeugt ein neues Dokument; die Akte storniert nichts von selbst.
 */
export async function issueAttendanceList(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documentId: string; number: string }>> {
  const meeting = await load(deps, ctx, input);
  if (!meeting.ok) return meeting;
  const m = meeting.value;
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: ATTENDANCE_LIST_TEMPLATE_KEY,
    input: attendanceListInputInternal(deps.db, m),
    subject: `${ATTACHMENT_WORDS.attendanceTitle} ${day(m.heldOn)}`,
    documentDate: m.heldOn,
    links: [{ entityType: 'governanceMeeting', entityId: m.id }],
    afterIssue: (tx, doc) => recordAudit(tx, deps, ctx, { action: 'governance.minutes.attendanceList', entityType: 'governanceMeeting', entityId: m.id, after: { documentId: doc.id }, params: { documentNumber: doc.number } }),
  });
  if (!issued.ok) return issued;
  return ok({ documentId: issued.value.document.id, number: issued.value.document.number ?? '' });
}

/** `governance.manage`: „Angaben für die Registeranmeldung“ (`RGA`) an der Sitzung ausstellen; das Protokoll nennt nur Nummer und Zahl. */
export async function issueRegisterData(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ documentId: string; number: string }>> {
  const meeting = await load(deps, ctx, input);
  if (!meeting.ok) return meeting;
  const m = meeting.value;
  const data = registerDataInputInternal(deps.db, m);
  // G-26: Ohne Gewählte in ein vertretendes Amt gibt es nichts anzumelden.
  if (data.rows.length === 0) return governanceConflict('registerDataEmpty');
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: REGISTER_DATA_TEMPLATE_KEY,
    input: data,
    subject: `${ATTACHMENT_WORDS.registerTitle} ${day(m.heldOn)}`,
    documentDate: m.heldOn,
    links: [{ entityType: 'governanceMeeting', entityId: m.id }],
    afterIssue: (tx, doc) => recordAudit(tx, deps, ctx, { action: 'governance.minutes.registerData', entityType: 'governanceMeeting', entityId: m.id, after: { documentId: doc.id, count: data.rows.length }, params: { documentNumber: doc.number, count: data.rows.length } }),
  });
  if (!issued.ok) return issued;
  return ok({ documentId: issued.value.document.id, number: issued.value.document.number ?? '' });
}
