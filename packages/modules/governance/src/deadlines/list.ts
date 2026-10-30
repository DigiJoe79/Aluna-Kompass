import { ok, readSetting, requirePermission, schema, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { addCalendarDays, addCalendarMonths } from '@kompass/module-finance';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { meetingStateOf } from '../meetings';
import { resolveRule } from '../rules/resolve';
import { filingViewInternal, registerDueOn } from '../register/filings';
import { openOccasionsInternal } from '../register/occasions-open';
import { transparencyReportDueInternal } from '../register/transparency-rules';
import { governanceAgendaItems, governanceMeetings, governanceOffices, governanceOrgans, governanceRegisterFilings, governanceResolutions, governanceStatutes } from '../schema';
import { statuteRulesOnInternal, taxNoticeDueOn } from '../statutes';
import { boardLeaderlessInternal, officesDueInternal } from '../term-schedule';
import { noticeDeadlineInternal } from './notice';
import { circularDeadlinesInternal } from '../circular-deadlines';

/** Arten der Gremienfristen (Spec § 11); G4 ergänzt Protokoll und Aufträge, G5 Register, Auflösung und Finanzamt. */
export const GOVERNANCE_DEADLINE_KINDS = [
  'inviteBy',
  'motionsBy',
  'ordinaryMeetingMissing',
  'termEnding',
  'electionDue',
  'seatVacant',
  'boardLeaderless',
  'minutesUnsigned',
  'mandate',
  'registerDue',
  'interimOrder',
  'dissolutionNotice',
  'transparencyReport',
  'taxPreSubmission',
  'taxNoticeRequest',
  'circularDue',
] as const;
export type GovernanceDeadlineKind = (typeof GOVERNANCE_DEADLINE_KINDS)[number];
/** Begründung am Hinweis „Registeranmeldung überfällig“ (Spec § 7.1, Rechtsprüfung M3). */
const COERCIVE_FINE_NORMS = '§ 78 Abs. 1 BGB, § 20a Abs. 2 GwG';
/** Begründung am Hinweis „Meldung an das Transparenzregister nötig“: Wechsel nicht unverzüglich angemeldet. */
const TRANSPARENCY_REPORT_NORM = '§ 20a Abs. 2 GwG';

/** Nach so vielen Tagen ohne Festschreiben erscheint eine beendete Sitzung als offen (Spec § 11: vier Wochen). */
const MINUTES_UNSIGNED_DAYS = 28;
export interface GovernanceDeadline {
  key: string;
  kind: GovernanceDeadlineKind;
  dueOn: string | null;
  overdue: boolean;
  params: Record<string, string | number>;
  /** Ziel in der Oberfläche (Plan U2: jede Frist hat eines). */
  href: string | null;
}

/** Die Sitzung als Vorgang (Plan U1). */
const meetingHref = (id: string) => `/governance/meetings/${id}`;
/** Registeranmeldung, Organ, Beschluss, Satzungsstand (Plan U2). */
const filingHref = (id: string) => `/governance/register/${id}`;
const organHref = (id: string) => `/governance/organs/${id}`;

export const governanceDeadlinesSchema = z.object({});

/**
 * Die Fristen der Gremien am Tag `today` — berechnet, nie gespeichert (Spec § 11): Einladung und Anträge geplanter
 * Sitzungen, fehlende ordentliche Versammlung, auslaufende Amtszeiten, freie Plätze, führungsloser Vorstand, nicht
 * festgeschriebene Protokolle, offene Aufträge.
 */
export function governanceDeadlinesInternal(deps: Deps, today: string): GovernanceDeadline[] {
  const db = deps.db;
  const out: GovernanceDeadline[] = [];
  const meetings = db.select().from(governanceMeetings).all();
  for (const meeting of meetings) {
    const state = meetingStateOf(meeting);
    if (meeting.heldOn < today || (state !== 'planned' && state !== 'invited')) continue;
    const deadline = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn);
    const params = { heldOn: meeting.heldOn, kind: meeting.kind };
    const href = meetingHref(meeting.id);
    const inviteBy = deadline.sendBy.post ?? deadline.lastReceiptDay;
    if (state === 'planned' && inviteBy) out.push({ key: `inviteBy:${meeting.id}`, kind: 'inviteBy', dueOn: inviteBy, overdue: today > inviteBy, params, href });
    if (deadline.motionsBy && today <= deadline.motionsBy) out.push({ key: `motionsBy:${meeting.id}`, kind: 'motionsBy', dueOn: deadline.motionsBy, overdue: false, params, href });
  }
  // Beendet, aber nicht festgeschrieben: ab Tag 29 nach der Sitzung (Spec § 11).
  for (const meeting of meetings) {
    const dueOn = addCalendarDays(meeting.heldOn, MINUTES_UNSIGNED_DAYS);
    if (meetingStateOf(meeting) === 'recorded' && today > dueOn) out.push({ key: `minutesUnsigned:${meeting.id}`, kind: 'minutesUnsigned', dueOn, overdue: true, params: { heldOn: meeting.heldOn, kind: meeting.kind }, href: meetingHref(meeting.id) });
  }
  // Aufträge (Spec § 6): die offenen Wiedervorlagen des Kerns an Beschlüssen der Gremien.
  const mandates = db
    .select({ id: schema.followUps.id, dueAt: schema.followUps.dueAt, number: governanceResolutions.number, resolutionId: governanceResolutions.id })
    .from(schema.followUps)
    .innerJoin(governanceResolutions, eq(governanceResolutions.id, schema.followUps.entityId))
    .where(and(eq(schema.followUps.entityType, 'governanceResolution'), isNull(schema.followUps.doneAt)))
    .all();
  for (const m of mandates) out.push({ key: `mandate:${m.id}`, kind: 'mandate', dueOn: m.dueAt, overdue: today > m.dueAt, params: { number: m.number ?? '' }, href: `/governance/resolutions/${m.resolutionId}` });
  const assembly = db.select().from(governanceOrgans).where(eq(governanceOrgans.kind, 'assembly')).get();
  const year = today.slice(0, 4);
  // Ab dem Stichtag `governance.ordinaryMeetingWarnFrom` (`MM-TT`, Vorgabe 1. Oktober).
  if (assembly && today.slice(5) >= readSetting<string>(deps, 'governance.ordinaryMeetingWarnFrom') && resolveRule(statuteRulesOnInternal(db, today).rules, assembly.id, 'ordinaryMeetingYearly').value === true) {
    const held = meetings.some((m) => m.organId === assembly.id && m.kind === 'ordinary' && !m.cancelledOn && m.heldOn.startsWith(`${year}-`));
    if (!held) out.push({ key: `ordinaryMeetingMissing:${year}`, kind: 'ordinaryMeetingMissing', dueOn: `${year}-12-31`, overdue: false, params: { year: Number(year) }, href: `/governance/meetings/new?organ=${assembly.id}&kind=ordinary` });
  }
  const offices = new Map(db.select().from(governanceOffices).all().map((o) => [o.id, o]));
  const nextAssemblyOn =
    meetings
      .filter((m) => assembly && m.organId === assembly.id && m.heldOn >= today && ['planned', 'invited'].includes(meetingStateOf(m)))
      .map((m) => m.heldOn)
      .sort()[0] ?? null;
  for (const due of officesDueInternal(db, today)) {
    const office = offices.get(due.officeId)!.name;
    const href = organHref(due.organId);
    if (due.reason === 'vacant') out.push({ key: `seatVacant:${due.officeId}`, kind: 'seatVacant', dueOn: null, overdue: false, params: { office }, href });
    // Ersatzweise bestellt (ohne Ende): zur Nachwahl fällig, am Tag der nächsten Mitgliederversammlung, sonst ohne Tag (V-11).
    else if (due.endsOn === null) out.push({ key: `electionDue:${due.termId}`, kind: 'electionDue', dueOn: nextAssemblyOn, overdue: false, params: { office }, href });
    else out.push({ key: `termEnding:${due.termId}`, kind: 'termEnding', dueOn: due.endsOn, overdue: due.endsOn < today, params: { office, endsOn: due.endsOn }, href });
  }
  if (boardLeaderlessInternal(db, today)) out.push({ key: 'boardLeaderless', kind: 'boardLeaderless', dueOn: null, overdue: true, params: {}, href: '/governance' });
  out.push(...registerDeadlinesInternal(deps, today, meetings));
  out.push(...circularDeadlinesInternal(db, today));
  return out.sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.key.localeCompare(b.key));
}

/**
 * Fristen aus Register, Auflösung und Finanzamt (Plan G5): offener Anlass oder fällige Anmeldung — überfällig nach
 * `governance.registerOverdueDays` mit Hinweis auf Zwangsgeld und Transparenzregister —, Zwischenverfügung mit Frist,
 * Mitteilung der Auflösung (§ 137 AO), Meldung an das Transparenzregister (§ 20a Abs. 2 Nr. 1 GwG), Vorabvorlage beim Finanzamt (Praxis,
 * nie überfällig) und neuer Bescheid binnen `governance.taxNoticeRequestDays` nach der Eintragung (§ 60a Abs. 4 AO).
 */
function registerDeadlinesInternal(deps: Deps, today: string, meetings: (typeof governanceMeetings.$inferSelect)[]): GovernanceDeadline[] {
  const db = deps.db;
  const out: GovernanceDeadline[] = [];
  const due = (key: string, occasion: string, occurredOn: string, href: string) => {
    const dueOn = registerDueOn(deps, occurredOn);
    const overdue = today > dueOn;
    out.push({ key, kind: 'registerDue', dueOn, overdue, params: { occasion, occurredOn, hint: overdue ? 'coerciveFine' : 'none', norms: COERCIVE_FINE_NORMS }, href });
  };
  for (const o of openOccasionsInternal(db, today)) {
    due(`registerDue:${o.id ?? (o.statuteId ? `statute:${o.statuteId}` : `term:${o.termId}`)}`, o.kind, o.occurredOn, '/governance/register/new');
    if (o.kind === 'dissolution') {
      const dueOn = addCalendarMonths(o.occurredOn, 1);
      out.push({ key: `dissolutionNotice:${o.id}`, kind: 'dissolutionNotice', dueOn, overdue: today > dueOn, params: { decidedOn: o.occurredOn }, href: '/governance/register' });
    }
  }
  for (const row of db.select().from(governanceRegisterFilings).all()) {
    const filing = filingViewInternal(db, deps, row, today);
    const first = filing.occasions[0];
    if (filing.state === 'due' && first) due(`registerDue:${filing.id}`, first.kind, first.occurredOn, filingHref(filing.id));
    filing.interimOrders.forEach((o, i) => {
      if (o.resolvedOn === null && o.deadline) out.push({ key: `interimOrder:${filing.id}:${i}`, kind: 'interimOrder', dueOn: o.deadline, overdue: today > o.deadline, params: { on: o.on }, href: filingHref(filing.id) });
    });
    const d = filing.dissolution;
    if (d && !(d.taxOfficeNotifiedOn && d.municipalityNotifiedOn)) out.push({ key: `dissolutionNotice:${filing.id}`, kind: 'dissolutionNotice', dueOn: d.noticeDueOn, overdue: today > d.noticeDueOn, params: { decidedOn: d.decidedOn }, href: filingHref(filing.id) });
    // § 20a Abs. 2 GwG: selbst melden, wenn der Wechsel nicht unverzüglich angemeldet ist (Frage 1, fällig seit der Grenze
    // `registerOverdueDays`) oder eine der Fragen 2–4 bejaht ist — bis die Bestätigung der Meldung abgelegt ist.
    if (transparencyReportDueInternal(filing.transparency)) {
      const dueOn = filing.transparency.promptlyBy ?? today;
      out.push({ key: `transparencyReport:${filing.id}`, kind: 'transparencyReport', dueOn, overdue: today > dueOn, params: { norm: TRANSPARENCY_REPORT_NORM }, href: filingHref(filing.id) });
    }
  }
  const statutes = new Map(db.select().from(governanceStatutes).all().map((s) => [s.id, s]));
  for (const meeting of meetings) {
    const state = meetingStateOf(meeting);
    if (meeting.heldOn < today || (state !== 'planned' && state !== 'invited')) continue;
    const items = db.select().from(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, meeting.id)).all();
    const pending = items.some((i) => (i.kind === 'statute' || i.kind === 'purpose') && i.statuteId && statutes.get(i.statuteId)?.taxReview.affectsCharity === true && statutes.get(i.statuteId)?.taxReview.submittedOn === null);
    if (!pending) continue;
    const deadline = noticeDeadlineInternal(db, meeting.organId, meeting.heldOn);
    // Spec § 4.1: Praxis, kein Muss — deshalb nie überfällig.
    out.push({ key: `taxPreSubmission:${meeting.id}`, kind: 'taxPreSubmission', dueOn: deadline.sendBy.post ?? deadline.lastReceiptDay ?? meeting.heldOn, overdue: false, params: { heldOn: meeting.heldOn }, href: meetingHref(meeting.id) });
  }
  for (const s of statutes.values()) {
    if (s.registeredOn === null || s.registeredOn > today || s.taxReview.affectsCharity !== true || s.taxReview.answer === 'newNotice') continue;
    // Fällig `governance.taxNoticeRequestDays` nach der Eintragung, danach überfällig (Joe 2026-10-28/29) — wie die Warnung am Stand.
    const dueOn = taxNoticeDueOn(deps, s.registeredOn);
    out.push({ key: `taxNoticeRequest:${s.id}`, kind: 'taxNoticeRequest', dueOn, overdue: today > dueOn, params: { registeredOn: s.registeredOn }, href: `/governance/statutes/${s.id}` });
  }
  return out;
}

/** Die Fristenliste der Gremien. */
export async function listGovernanceDeadlines(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<GovernanceDeadline[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, governanceDeadlinesSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(governanceDeadlinesInternal(deps, todayIn(deps)));
}
