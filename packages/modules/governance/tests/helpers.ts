import { coreModule, schema, unwrap, writeSettingInternal, type CallContext, type MailTransport } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule, createContact, setContactChannels } from '@kompass/module-contacts';
import { dmsModule, receiveDocument, textPdf } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { admitMember, memberTypes, membersModule, recordApplication } from '@kompass/module-members';
import { projectsModule } from '@kompass/module-projects';
import { governanceModule } from '../src/manifest';
import { saveAgendaItem } from '../src/agenda';
import type { AgendaKind } from '../src/agenda-kinds';
import { prefillAttendance, recordArrival } from '../src/attendance';
import { createMeeting } from '../src/meetings';
import { governanceOffices, governanceOrgans, type MeetingKind, type OfficeFunction } from '../src/schema';
import { startMeeting } from '../src/session';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { startTerm } from '../src/terms';
import type { OrganRules } from '../src/rules/schema';

export const GOVERNANCE_PERMISSIONS = ['governance.read', 'governance.manage'] as const;
/** Dazu der Mitlauf (Plan G3). */
export const RECORDING = [...GOVERNANCE_PERMISSIONS, 'governance.record'] as const;

/** Gremien eingeschaltet samt Abhängigkeiten, Grundausstattung angelegt. `now` setzt die Uhr (Vorgabe `TEST_NOW`, 2026). */
export function setupGovernance(permissions: readonly string[] = GOVERNANCE_PERMISSIONS, opts: { now?: string; mail?: MailTransport } = {}) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule, membersModule, governanceModule], ...(opts.now ? { now: opts.now } : {}), ...(opts.mail ? { mail: opts.mail } : {}) });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members', 'governance']));
  deps.db.transaction((tx) => {
    dmsModule.install?.(tx, deps, systemContext());
    // Finanzen bringen die Art `minutes` (`PRT`) mit, in die das Protokoll der Versammlung geht (Plan G4).
    financeModule.install?.(tx, deps, systemContext());
    membersModule.install?.(tx, deps, systemContext());
    governanceModule.install?.(tx, deps, systemContext());
  });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}
export type GovernanceDeps = ReturnType<typeof setupGovernance>['deps'];

/** Ein erfundener Kontakt, angelegt über den Dienst der Kontakte mit eigenem Recht. */
export async function person(deps: GovernanceDeps, lastName = 'Beispiel', firstName = 'Erika'): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  return unwrap(await createContact(deps, ctx, { kind: 'person', firstName, lastName })).id;
}

/** Die Einträge einer Aktion im Protokoll, `params` gelesen. */
export function auditOf(deps: GovernanceDeps, action: string) {
  return deps.db
    .select()
    .from(schema.auditLog)
    .all()
    .filter((e) => e.action === action)
    .map((e) => ({ ...e, params: e.params ? (JSON.parse(e.params) as Record<string, unknown>) : null }));
}

export const asMcp = (ctx: CallContext): CallContext => ({ ...ctx, channel: 'mcp' });

/** Ein eingegangenes Dokument der Akte (erfunden), etwa als Anlage oder als Antrag. */
export async function receivedDocument(deps: GovernanceDeps, subject = 'Eingang'): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['dms.create', 'dms.view', 'dms.manage']) };
  return unwrap(await receiveDocument(deps, ctx, { filename: 'eingang.pdf', typeKey: 'unclassified-in', subject, documentDate: '2026-06-30', folder: null, bytes: textPdf([subject]) })).id;
}

/** Ein Mitglied (Aufnahme ohne Antrag, ohne Beiträge und Brief) — `type` nach Schlüssel der Grundausstattung. */
export async function member(deps: GovernanceDeps, opts: { contactId?: string; type?: 'regular' | 'supporting' | 'honorary'; admittedOn?: string } = {}): Promise<{ membershipId: string; contactId: string }> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['members.manage']) };
  const contactId = opts.contactId ?? (await person(deps, 'Mitglied'));
  const typeId = deps.db.select().from(memberTypes).all().find((t) => t.key === (opts.type ?? 'regular'))!.id;
  const admitted = unwrap(await admitMember(deps, ctx, { contactId, typeId, admittedOn: opts.admittedOn ?? '2025-01-01', createFees: false, letter: false }));
  return { membershipId: admitted.id, contactId };
}

/** Ein erfundener Kontakt für Briefe: mit Anschrift (abschaltbar) und, wenn gewünscht, E-Mail. */
export async function addressedPerson(deps: GovernanceDeps, opts: { address?: boolean; email?: string; lastName?: string } = {}): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const address = opts.address === false ? {} : { street: 'Lindenweg 4', postalCode: '12345', city: 'Beispielstadt' };
  const id = unwrap(await createContact(deps, ctx, { kind: 'person', salutation: 'Frau', firstName: 'Erika', lastName: opts.lastName ?? 'Beispiel', ...address })).id;
  if (opts.email) unwrap(await setContactChannels(deps, ctx, { id, channels: [{ kind: 'email', value: opts.email, isPrimary: true }] }));
  return id;
}

/** Ein minderjähriges Mitglied mit gesetzlicher Vertretung (Antrag, dann Aufnahme). */
export async function minorMember(deps: GovernanceDeps, guardianContactId: string, birthDate = '2015-04-01'): Promise<{ membershipId: string; contactId: string }> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['members.manage']) };
  const contactId = await addressedPerson(deps, { lastName: 'Kind' });
  const typeId = deps.db.select().from(memberTypes).all().find((t) => t.key === 'regular')!.id;
  const applied = unwrap(await recordApplication(deps, ctx, { contactId, typeId, appliedOn: '2025-01-01', birthDate, guardianContactId }));
  unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2025-01-02', createFees: false, letter: false }));
  return { membershipId: applied.id, contactId };
}

/** Die ID des Organs der Grundausstattung. */
export const organOf = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
/** Die ID des ersten Amts mit der Funktion. */
export const officeOf = (deps: GovernanceDeps, fn: OfficeFunction) => deps.db.select().from(governanceOffices).all().find((o) => o.function === fn)!.id;

/** Eine Sitzung des Organs am `heldOn`, begonnen von `ctx` (braucht `governance.record`). */
export async function runningMeeting(deps: GovernanceDeps, ctx: CallContext, kind: MeetingKind, heldOn = '2026-09-05', startsAt = '19:00') {
  const organId = organOf(deps, kind === 'board' ? 'board' : 'assembly');
  const meeting = unwrap(await createMeeting(deps, ctx, { organId, kind, heldOn, startsAt, form: 'inPerson' }));
  return unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
}

/** Je Funktion eine Inhaberschaft (nachgetragen) seit `since`; liefert die Kontakte in derselben Reihenfolge. */
export async function holders(deps: GovernanceDeps, ctx: CallContext, functions: OfficeFunction[], since = '2026-01-01'): Promise<string[]> {
  const ids: string[] = [];
  for (const fn of functions) {
    const contactId = await person(deps, `Amt ${fn} ${ids.length}`);
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, fn), contactId, since, origin: 'backfilled' }));
    ids.push(contactId);
  }
  return ids;
}

/** Ein beschlossener Satzungsstand (Beschluss am `on`) mit Regeln je Organ-Art. */
export async function withRules(deps: GovernanceDeps, ctx: CallContext, rules: { assembly?: OrganRules; board?: OrganRules }, on = '2026-01-10') {
  const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  const organs: Record<string, OrganRules> = {};
  if (rules.assembly) organs[organOf(deps, 'assembly')] = rules.assembly;
  if (rules.board) organs[organOf(deps, 'board')] = rules.board;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on, resolutionId: null }], rules: { organs } }));
  return id;
}

/**
 * Eine laufende Versammlung (oder Vorstandssitzung) mit Tagesordnung und `voters` stimmberechtigten Anwesenden ab
 * Beginn 19:00: bei der Versammlung neue ordentliche Mitglieder, beim Vorstand die Inhaber von `boardFunctions`.
 */
export async function session(deps: GovernanceDeps, ctx: CallContext, opts: { kind?: MeetingKind; items: AgendaKind[]; voters?: number; boardFunctions?: OfficeFunction[]; heldOn?: string; prepare?: (meetingId: string) => Promise<void> }) {
  const kind = opts.kind ?? 'ordinary';
  const contactIds: string[] = [];
  if (kind === 'board') contactIds.push(...(await holders(deps, ctx, opts.boardFunctions ?? ['chair', 'board', 'treasurer'])));
  else for (let i = 0; i < (opts.voters ?? 0); i++) contactIds.push((await member(deps)).contactId);
  const organId = organOf(deps, kind === 'board' ? 'board' : 'assembly');
  const heldOn = opts.heldOn ?? '2026-09-05';
  const meeting = unwrap(await createMeeting(deps, ctx, { organId, kind, heldOn, startsAt: '19:00', form: 'inPerson' }));
  const items = [];
  for (const [i, itemKind] of opts.items.entries()) items.push(unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: itemKind, title: `TOP ${i + 1}` })));
  await opts.prepare?.(meeting.id);
  unwrap(await startMeeting(deps, ctx, { meetingId: meeting.id }));
  const rows = unwrap(await prefillAttendance(deps, ctx, { meetingId: meeting.id }));
  for (const row of rows) unwrap(await recordArrival(deps, ctx, { attendanceId: row.id, at: '19:00' }));
  return { meeting, items, contactIds, organId, attendance: rows };
}

/** Wahl „einstimmig“ ins Amt samt Annahme am Sitzungstag (oder `acceptedOn`). */
export async function elect(deps: GovernanceDeps, ctx: CallContext, agendaItemId: string, officeId: string, contactId: string, opts: { votedAt?: string; acceptedOn?: string } = {}) {
  const { saveElectionRound, acceptElection } = await import('../src/elections');
  const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId, officeId, votedAt: opts.votedAt ?? '19:30', round: { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: contactId } }));
  return unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId, ...(opts.acceptedOn ? { acceptedOn: opts.acceptedOn } : {}) }));
}

/** Ein Beschluss „einstimmig angenommen“ (oder mit einer Nein-Stimme abgelehnt) am TOP, mit Angaben. */
export async function adopt(deps: GovernanceDeps, ctx: CallContext, agendaItemId: string, opts: { details?: unknown; votedAt?: string; text?: string; outcome?: 'adopted' | 'rejected' | null } = {}) {
  const { saveResolution, decideResolution } = await import('../src/resolutions');
  // Abgelehnt mit einer Nein-Stimme, sonst einstimmig — eine Feststellung gegen die Zählung bräuchte einen Grund.
  const votes = opts.outcome === 'rejected' ? { votes: { yes: 0, no: 1, abstain: 0 } } : { unanimous: true };
  const r = unwrap(await saveResolution(deps, ctx, { agendaItemId, text: opts.text ?? 'Beschlusstext', votedAt: opts.votedAt ?? '19:20', ...votes, ...(opts.details !== undefined ? { details: opts.details } : {}) }));
  if (opts.outcome === null) return r;
  return unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: opts.outcome ?? 'adopted' }));
}
