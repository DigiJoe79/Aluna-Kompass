import { invalid, isoNow, newId, notFound, ok, readSetting, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, displayName, endManagedRoleInternal, startManagedRoleInternal } from '@kompass/module-contacts';
import { documentLinks, documents, voidDocumentInternal } from '@kompass/module-dms';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, MembersAborted, membersConflict } from './errors';
import { letterAfterStep, type LetterOutcome } from './letters/issue';
import { recalculateChargesInternal } from './fee-recalc';
import { admissionCreatesFees, createChargesForMembershipInternal } from './fee-run';
import { drawMemberNumber, formatMemberNumber } from './numbers';
import { proposeResignationEnd } from './resignation';
import { RESIGNATION_TEMPLATE_KEY } from './letters/resignation';
import { deleteMembershipInternal, openFeeCountInternal, retainUntilOf } from './retention';
import { END_REASONS, memberFeeCharges, memberMemberships, memberTypePeriods, memberTypes, type MemberTypePeriodRow, type MemberTypeRow, type MembershipRow } from './schema';
import type { MemberNumberFormat, ResignationNotice } from './settings';
import { MEMBERSHIP_STATUSES, membershipStatus, RUNNING_STATUSES, type MembershipStatus } from './status';

export const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';
const ROLE = 'member';

/** Eine Mitgliedschaft, wie Dienste und Werkzeuge sie zeigen: Zustand und Art zum heutigen Tag, Name des Kontakts. */
export type MembershipView = MembershipRow & { status: MembershipStatus; typeId: string; typeKey: string; hasVotingRight: boolean; contactName: string };
/** Ergebnis eines Ablaufs mit Brief: die Mitgliedschaft und, was mit dem Brief geschah (Plan M4). */
export type MembershipWithLetter = MembershipView & { letter: LetterOutcome };

const day = z.iso.date();
const id = z.string().min(1);

export const membershipApplySchema = z.object({
  contactId: id,
  typeId: id,
  appliedOn: day,
  birthDate: day.nullable().optional(),
  guardianContactId: id.nullable().optional(),
  applicationDocumentId: id.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export const membershipAdmitSchema = z.object({
  /** Ein offener Antrag; ohne ihn ist es eine Aufnahme ohne Antrag (Gründungsmitglied, Nachtrag), dann sind `contactId` und `typeId` Pflicht. */
  membershipId: id.optional(),
  contactId: id.optional(),
  typeId: id.optional(),
  admittedOn: day,
  /** Beginn der Mitgliedschaft; Vorgabe `admittedOn`. */
  joinedOn: day.optional(),
  /** Nur ohne `membershipId`: Tag des Antrags, falls es einen gab. */
  appliedOn: day.nullable().optional(),
  /** Beiträge des Eintrittsjahres gleich anlegen (Plan M3), wenn das Jahr schon läuft oder einen Beitragslauf hat. */
  createFees: z.boolean().default(true),
  /** Aufnahmebestätigung ausstellen (Plan M4); Vorgabe ja, außer beim Nachtrag ohne Antrag und über einen Agenten. */
  letter: z.boolean().optional(),
});
export const membershipRejectSchema = z.object({ membershipId: id, rejectedOn: day, letter: z.boolean().optional() });
export const membershipChangeTypeSchema = z.object({ membershipId: id, typeId: id, validFrom: day });
export const membershipResignSchema = z.object({ membershipId: id, noticeOn: day, endsOn: day.optional(), letter: z.boolean().optional() });
export const membershipEndSchema = z.object({ membershipId: id, endsOn: day, reason: z.enum(END_REASONS.filter((r) => r !== 'resignation') as ['exclusion', 'struckOff', 'death', 'other']), documentId: id.nullable().optional() });
export const membershipRevokeEndSchema = z.object({ membershipId: id });
export const membershipListSchema = z.object({
  status: z.array(z.enum(MEMBERSHIP_STATUSES)).optional(),
  typeId: id.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

// ── Lesen ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Die Periode, die am Tag `on` gilt; vor der ersten gilt die erste (ein Antrag mit künftigem Datum hat schon eine Art). */
export function periodAt(periods: readonly MemberTypePeriodRow[], on: string): MemberTypePeriodRow | undefined {
  const sorted = [...periods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return sorted.filter((p) => p.validFrom <= on).at(-1) ?? sorted[0];
}

/** Ansichten für viele Mitgliedschaften mit wenigen Abfragen. `on` ist der Tag für Zustand und Art (Vorgabe heute). */
export function membershipViews(db: DbOrTx, deps: Deps, rows: readonly MembershipRow[], on: string = todayIn(deps)): MembershipView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const periods = db.select().from(memberTypePeriods).where(inArray(memberTypePeriods.membershipId, ids)).all();
  const types = new Map(db.select().from(memberTypes).all().map((t) => [t.id, t]));
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const names = new Map(db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)]));
  return rows.map((row) => {
    const period = periodAt(periods.filter((p) => p.membershipId === row.id), on);
    const type = period ? types.get(period.typeId) : undefined;
    return { ...row, status: membershipStatus(row, on), typeId: type?.id ?? '', typeKey: type?.key ?? '', hasVotingRight: type?.hasVotingRight ?? false, contactName: names.get(row.contactId) ?? '' };
  });
}

const loadRow = (db: DbOrTx, membershipId: string): MembershipRow | undefined => db.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
export const loadView = (db: DbOrTx, deps: Deps, membershipId: string): MembershipView => membershipViews(db, deps, [loadRow(db, membershipId)!])[0]!;

export async function getMembership(deps: Deps, ctx: CallContext, membershipId: string): Promise<Result<MembershipView>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const row = loadRow(deps.db, membershipId);
  return row ? ok(membershipViews(deps.db, deps, [row])[0]!) : notFound('membership', membershipId);
}

/** Gefilterte Mitgliedschaften — Zustand und Art zum heutigen Tag, nach Name sortiert. Ohne Grenze für den Export. */
export function filterMemberships(deps: Deps, filter: { status?: MembershipStatus[]; typeId?: string; search?: string }): MembershipView[] {
  const rows = deps.db.select().from(memberMemberships).all();
  const needle = filter.search?.toLocaleLowerCase('de') ?? '';
  return membershipViews(deps.db, deps, rows)
    .filter((v) => !filter.status || filter.status.length === 0 || filter.status.includes(v.status))
    .filter((v) => !filter.typeId || v.typeId === filter.typeId)
    .filter((v) => needle === '' || v.contactName.toLocaleLowerCase('de').includes(needle) || (v.memberNumber ?? '').toLocaleLowerCase('de').includes(needle))
    .sort((a, b) => a.contactName.localeCompare(b.contactName, 'de') || (a.memberNumber ?? '').localeCompare(b.memberNumber ?? '') || a.id.localeCompare(b.id));
}

export async function listMemberships(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: MembershipView[]; total: number }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, membershipListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { limit, offset, ...filter } = parsed.value;
  const all = filterMemberships(deps, filter);
  return ok({ items: all.slice(offset, offset + limit), total: all.length });
}

/** Die Mitgliedschaft eines Kontakts: die nicht beendete, sonst die jüngste, sonst keine. */
export async function membershipForContact(deps: Deps, ctx: CallContext, contactId: string): Promise<Result<MembershipView | null>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const rows = deps.db.select().from(memberMemberships).where(eq(memberMemberships.contactId, contactId)).orderBy(asc(memberMemberships.createdAt), asc(memberMemberships.id)).all();
  const views = membershipViews(deps.db, deps, rows);
  return ok(views.find((v) => RUNNING_STATUSES.includes(v.status)) ?? views.at(-1) ?? null);
}

// ── Prüfungen ──────────────────────────────────────────────────────────────────────────────────────────────────────

function runningFor(db: DbOrTx, deps: Deps, contactId: string): boolean {
  const today = todayIn(deps);
  return db
    .select()
    .from(memberMemberships)
    .where(eq(memberMemberships.contactId, contactId))
    .all()
    .some((r) => RUNNING_STATUSES.includes(membershipStatus(r, today)));
}

export function activeType(db: DbOrTx, typeId: string): MemberTypeRow | Failure {
  const type = db.select().from(memberTypes).where(eq(memberTypes.id, typeId)).get();
  if (!type) return notFound('memberType', typeId);
  return type.active ? type : membersConflict('memberTypeInactive');
}
const isFailure = (v: unknown): v is Failure => typeof v === 'object' && v !== null && 'ok' in v && (v as Failure).ok === false;

const contactExists = (db: DbOrTx, contactId: string) => !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get();
const documentExists = (db: DbOrTx, documentId: string) => !!db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).get();

/** Eine laufende (aktive oder endende) Mitgliedschaft, sonst der passende Fehler. */
function loadActive(deps: Deps, membershipId: string): MembershipRow | Failure {
  const row = loadRow(deps.db, membershipId);
  if (!row) return notFound('membership', membershipId);
  const status = membershipStatus(row, todayIn(deps));
  return status === 'active' || status === 'ending' ? row : membersConflict('membershipNotActive');
}

/** Ab wann nachgerechnet wird, wenn ein Ende gesetzt oder verschoben wird: das frühere der beiden Enden. */
const earlier = (a: string | null, b: string): string => (a !== null && a < b ? a : b);

const beforeJoined = (path: string) => invalid([{ path, message: 'beforeJoined' }]);

/**
 * Plan N1 (M2, M5): Ein Antrag liegt nicht in der Zukunft, ein Geburtsdatum ebenso nicht, und die Vertretung ist eine
 * andere Person. Die Reihenfolge Antrag → Aufnahme/Ablehnung ist bei einer Prüfung ein Beleg.
 */
export function applicationIssues(today: string, v: { contactId?: string; appliedOn?: string | null; birthDate?: string | null; guardianContactId?: string | null; admittedOn?: string | null }): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (v.appliedOn && v.appliedOn > today) issues.push({ path: 'appliedOn', message: 'inFuture' });
  if (v.birthDate && v.birthDate > today) issues.push({ path: 'birthDate', message: 'inFuture' });
  if (v.guardianContactId && v.contactId && v.guardianContactId === v.contactId) issues.push({ path: 'guardianContactId', message: 'guardianIsMember' });
  if (v.admittedOn && v.appliedOn && v.admittedOn < v.appliedOn) issues.push({ path: 'admittedOn', message: 'beforeApplied' });
  return issues;
}

function setPeriod(tx: DbOrTx, membershipId: string, typeId: string, validFrom: string): void {
  const same = tx.select().from(memberTypePeriods).where(and(eq(memberTypePeriods.membershipId, membershipId), eq(memberTypePeriods.validFrom, validFrom))).get();
  if (same) tx.update(memberTypePeriods).set({ typeId }).where(eq(memberTypePeriods.id, same.id)).run();
  else tx.insert(memberTypePeriods).values({ id: newId(), membershipId, typeId, validFrom }).run();
}

// ── Abläufe ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Antrag erfassen: Mitgliedschaft `applied` mit der gewünschten Art ab dem Antragstag. Noch keine Nummer, keine Rolle. */
export async function recordApplication(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipView>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, membershipApplySchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const issues = applicationIssues(todayIn(deps), v);
  if (issues.length > 0) return invalid(issues);
  if (!contactExists(deps.db, v.contactId)) return notFound('contact', v.contactId);
  if (v.guardianContactId && !contactExists(deps.db, v.guardianContactId)) return notFound('contact', v.guardianContactId);
  if (v.applicationDocumentId && !documentExists(deps.db, v.applicationDocumentId)) return notFound('document', v.applicationDocumentId);
  const type = activeType(deps.db, v.typeId);
  if (isFailure(type)) return type;
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => ok(loadView(tx, deps, applyInternal(tx, deps, ctx, v, type)))));
}

/** Antrag in der Transaktion des Aufrufers (geprüft hat er Rechte, Kontakt und Art); `MembersAborted`, wenn schon einer läuft. */
export function applyInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, v: z.infer<typeof membershipApplySchema>, type: MemberTypeRow): string {
  if (runningFor(tx, deps, v.contactId)) throw new MembersAborted(membersConflict('membershipRunning'));
  const now = isoNow(deps.clock);
  const membershipId = newId();
  tx.insert(memberMemberships)
    .values({ id: membershipId, contactId: v.contactId, appliedOn: v.appliedOn, birthDate: v.birthDate ?? null, guardianContactId: v.guardianContactId ?? null, applicationDocumentId: v.applicationDocumentId ?? null, notes: v.notes ?? null, createdAt: now, updatedAt: now })
    .run();
  setPeriod(tx, membershipId, type.id, v.appliedOn);
  recordAudit(tx, deps, ctx, { action: 'members.membership.apply', entityType: 'membership', entityId: membershipId, after: { contactId: v.contactId, typeKey: type.key, appliedOn: v.appliedOn } });
  return membershipId;
}

/**
 * Aufnehmen (nur ein Mensch): vergibt die Nummer in derselben Transaktion, setzt den Beginn, die Art ab dem Beginn und
 * die Rolle `member`. Mit `membershipId` ein offener Antrag, ohne eine Aufnahme ohne Antrag.
 */
export async function admitMember(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipWithLetter>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, membershipAdmitSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const joinedOn = v.joinedOn ?? v.admittedOn;

  let application: MembershipRow | undefined;
  if (v.membershipId) {
    application = loadRow(deps.db, v.membershipId);
    if (!application) return notFound('membership', v.membershipId);
    if (membershipStatus(application, todayIn(deps)) !== 'applied') return membersConflict('membershipNotApplied');
    if (application.appliedOn && v.admittedOn < application.appliedOn) return invalid([{ path: 'admittedOn', message: 'beforeApplied' }]);
  } else {
    const issues = applicationIssues(todayIn(deps), { appliedOn: v.appliedOn, admittedOn: v.admittedOn });
    if (issues.length > 0) return invalid(issues);
    const missing = [...(v.contactId ? [] : ['contactId']), ...(v.typeId ? [] : ['typeId'])];
    if (missing.length > 0) return invalid(missing.map((path) => ({ path, message: 'required' })));
    if (!contactExists(deps.db, v.contactId!)) return notFound('contact', v.contactId!);
  }
  const typeId = v.typeId ?? periodAt(deps.db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, application!.id)).all(), joinedOn)!.typeId;
  const type = activeType(deps.db, typeId);
  if (isFailure(type)) return type;
  const format = readSetting<MemberNumberFormat>(deps, 'members.numberFormat');

  const admitted = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => ok(loadView(tx, deps, admitInternal(tx, deps, ctx, { application, contactId: v.contactId, type, admittedOn: v.admittedOn, joinedOn, appliedOn: v.appliedOn ?? null, createFees: v.createFees, format })))),
  );
  if (!admitted.ok) return admitted;
  // Für den Nachtrag ohne Antrag erzeugt Kompass keine Briefe (Spec § 3.3).
  const letter = await letterAfterStep(deps, ctx, v.letter, !!application, { kind: 'admission', membershipId: admitted.value.id });
  return ok({ ...admitted.value, letter });
}

/**
 * Aufnahme in der Transaktion des Aufrufers: zieht die Nummer, setzt Beginn, Art ab dem Beginn und die Rolle, legt auf
 * Wunsch die Beiträge des Eintrittsjahres an. Mit `application` ein offener Antrag, sonst eine neue Mitgliedschaft.
 */
export function admitInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  a: { application: MembershipRow | undefined; contactId: string | undefined; type: MemberTypeRow; admittedOn: string; joinedOn: string; appliedOn: string | null; createFees: boolean; format: MemberNumberFormat },
): string {
  const now = isoNow(deps.clock);
  let membershipId: string;
  let contactId: string;
  if (a.application) {
    membershipId = a.application.id;
    contactId = a.application.contactId;
    // Die Art gilt ab dem Beginn der Mitgliedschaft; die Periode des Antrags wird zu ihr.
    tx.delete(memberTypePeriods).where(eq(memberTypePeriods.membershipId, membershipId)).run();
  } else {
    contactId = a.contactId!;
    if (runningFor(tx, deps, contactId)) throw new MembersAborted(membersConflict('membershipRunning'));
    membershipId = newId();
    tx.insert(memberMemberships).values({ id: membershipId, contactId, appliedOn: a.appliedOn, createdAt: now, updatedAt: now }).run();
  }
  const memberNumber = formatMemberNumber(drawMemberNumber(tx), a.format);
  tx.update(memberMemberships).set({ memberNumber, admittedOn: a.admittedOn, joinedOn: a.joinedOn, updatedAt: now }).where(eq(memberMemberships.id, membershipId)).run();
  setPeriod(tx, membershipId, a.type.id, a.joinedOn);
  startManagedRoleInternal(tx, deps, ctx, { contactId, role: ROLE, since: a.joinedOn });
  recordAudit(tx, deps, ctx, { action: 'members.membership.admit', entityType: 'membership', entityId: membershipId, after: { memberNumber, admittedOn: a.admittedOn, joinedOn: a.joinedOn, typeKey: a.type.key }, params: { memberNumber } });
  const year = Number(a.joinedOn.slice(0, 4));
  if (a.createFees && admissionCreatesFees(tx, deps, year)) createChargesForMembershipInternal(tx, deps, ctx, membershipId, year, null);
  return membershipId;
}

/** Ablehnen (nur ein Mensch): nur ein offener Antrag; kein Grund nötig, keine Nummer verbraucht. */
export async function rejectApplication(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipWithLetter>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, membershipRejectSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRow(deps.db, parsed.value.membershipId);
  if (!row) return notFound('membership', parsed.value.membershipId);
  if (membershipStatus(row, todayIn(deps)) !== 'applied') return membersConflict('membershipNotApplied');
  if (row.appliedOn && parsed.value.rejectedOn < row.appliedOn) return invalid([{ path: 'rejectedOn', message: 'beforeApplied' }]);
  const rejected = deps.db.transaction((tx: DbOrTx) => {
    tx.update(memberMemberships).set({ rejectedOn: parsed.value.rejectedOn, updatedAt: isoNow(deps.clock) }).where(eq(memberMemberships.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'members.membership.reject', entityType: 'membership', entityId: row.id, after: { rejectedOn: parsed.value.rejectedOn } });
    return loadView(tx, deps, row.id);
  });
  const letter = await letterAfterStep(deps, ctx, parsed.value.letter, true, { kind: 'rejection', membershipId: row.id });
  return ok({ ...rejected, letter });
}

/** Art wechseln: neue Periode ab `validFrom`; eine am selben Tag wird ersetzt. Die Beiträge ab dann werden nachgerechnet. */
export async function changeMemberType(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipView>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, membershipChangeTypeSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadActive(deps, parsed.value.membershipId);
  if (isFailure(row)) return row;
  if (parsed.value.validFrom < row.joinedOn!) return beforeJoined('validFrom');
  const type = activeType(deps.db, parsed.value.typeId);
  if (isFailure(type)) return type;
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => {
    setPeriod(tx, row.id, type.id, parsed.value.validFrom);
    tx.update(memberMemberships).set({ updatedAt: isoNow(deps.clock) }).where(eq(memberMemberships.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'members.membership.changeType', entityType: 'membership', entityId: row.id, after: { typeKey: type.key, validFrom: parsed.value.validFrom }, params: { memberNumber: row.memberNumber!, typeKey: type.key } });
    recalculateChargesInternal(tx, deps, ctx, row.id, parsed.value.validFrom);
    return ok(loadView(tx, deps, row.id));
  }));
}

function setEnd(tx: DbOrTx, deps: Deps, ctx: CallContext, row: MembershipRow, end: { endsOn: string; endReason: MembershipRow['endReason']; endNoticeOn: string | null; endDocumentId: string | null }): void {
  tx.update(memberMemberships).set({ ...end, updatedAt: isoNow(deps.clock) }).where(eq(memberMemberships.id, row.id)).run();
  endManagedRoleInternal(tx, deps, ctx, { contactId: row.contactId, role: ROLE, until: end.endsOn });
}

/** Austritt erfassen: Ende nach der Kündigungsfrist der Einstellung, änderbar; die Rolle endet am selben Tag. */
export async function recordResignation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipWithLetter>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, membershipResignSchema, input);
  if (!parsed.ok) return parsed;
  // M9: Eine Kündigung ist eingegangen — nicht in der Zukunft.
  if (parsed.value.noticeOn > todayIn(deps)) return invalid([{ path: 'noticeOn', message: 'inFuture' }]);
  const row = loadActive(deps, parsed.value.membershipId);
  if (isFailure(row)) return row;
  // M10: Ein erfasster Austritt wird nicht still ersetzt — erst zurücknehmen.
  if (row.endsOn && row.endReason === 'resignation') return membersConflict('resignationExists', { endsOn: row.endsOn });
  const endsOn = parsed.value.endsOn ?? proposeResignationEnd(parsed.value.noticeOn, readSetting<ResignationNotice>(deps, 'members.resignationNotice'));
  if (endsOn < row.joinedOn!) return invalid([{ path: 'endsOn', message: 'endBeforeStart' }]);
  const resigned = catchAborted(() => deps.db.transaction((tx: DbOrTx) => {
    setEnd(tx, deps, ctx, row, { endsOn, endReason: 'resignation', endNoticeOn: parsed.value.noticeOn, endDocumentId: null });
    recordAudit(tx, deps, ctx, { action: 'members.membership.resign', entityType: 'membership', entityId: row.id, before: { endsOn: row.endsOn }, after: { endsOn, endNoticeOn: parsed.value.noticeOn }, params: { memberNumber: row.memberNumber!, endsOn } });
    recalculateChargesInternal(tx, deps, ctx, row.id, earlier(row.endsOn, endsOn));
    return ok(loadView(tx, deps, row.id));
  }));
  if (!resigned.ok) return resigned;
  const letter = await letterAfterStep(deps, ctx, parsed.value.letter, true, { kind: 'resignation', membershipId: row.id });
  return ok({ ...resigned.value, letter });
}

/** Ende aus anderem Grund: Ausschluss (mit Beschlussdokument), Streichung, Tod, Sonstiges. */
export async function endMembership(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipView>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, membershipEndSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadActive(deps, parsed.value.membershipId);
  if (isFailure(row)) return row;
  const { endsOn, reason } = parsed.value;
  if (endsOn < row.joinedOn!) return invalid([{ path: 'endsOn', message: 'endBeforeStart' }]);
  // M11 (Spec § 3.3): Ein Ausschluss braucht das Dokument des Beschlusses.
  if (reason === 'exclusion' && !parsed.value.documentId) return invalid([{ path: 'documentId', message: 'required' }]);
  const documentId = parsed.value.documentId ?? null;
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => {
    setEnd(tx, deps, ctx, row, { endsOn, endReason: reason, endNoticeOn: null, endDocumentId: documentId });
    recordAudit(tx, deps, ctx, { action: 'members.membership.end', entityType: 'membership', entityId: row.id, before: { endsOn: row.endsOn, endReason: row.endReason }, after: { endsOn, endReason: reason, endDocumentId: documentId }, params: { memberNumber: row.memberNumber!, reason, endsOn } });
    recalculateChargesInternal(tx, deps, ctx, row.id, earlier(row.endsOn, endsOn));
    return ok(loadView(tx, deps, row.id));
  }));
}

/** Ende zurücknehmen: nur solange das Ende in der Zukunft liegt (Austritt zurückgezogen). Die Rolle läuft wieder. */
export async function revokeEnd(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipView>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, membershipRevokeEndSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRow(deps.db, parsed.value.membershipId);
  if (!row) return notFound('membership', parsed.value.membershipId);
  if (membershipStatus(row, todayIn(deps)) !== 'ending') return membersConflict('membershipEnded');
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => {
    tx.update(memberMemberships).set({ endsOn: null, endReason: null, endNoticeOn: null, endDocumentId: null, updatedAt: isoNow(deps.clock) }).where(eq(memberMemberships.id, row.id)).run();
    endManagedRoleInternal(tx, deps, ctx, { contactId: row.contactId, role: ROLE, until: null });
    // M10: Eine Austrittsbestätigung, die noch nicht versandt ist, gilt nicht mehr — storniert, sonst ginge sie mit.
    const voided = voidUnsentResignationLettersInternal(tx, deps, ctx, row.id);
    recordAudit(tx, deps, ctx, { action: 'members.membership.revokeEnd', entityType: 'membership', entityId: row.id, before: { endsOn: row.endsOn, endReason: row.endReason, endNoticeOn: row.endNoticeOn }, after: { endsOn: null, voidedDocumentIds: voided }, params: { memberNumber: row.memberNumber!, voided: voided.length } });
    recalculateChargesInternal(tx, deps, ctx, row.id, row.endsOn!);
    return ok(loadView(tx, deps, row.id));
  }));
}

/** Die festgeschriebenen, nicht versandten Austrittsbestätigungen der Mitgliedschaft stornieren (M10). */
function voidUnsentResignationLettersInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membershipId: string): string[] {
  const linked = tx
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(documentLinks, eq(documentLinks.documentId, documents.id))
    .where(and(eq(documentLinks.entityType, 'membership'), eq(documentLinks.entityId, membershipId), eq(documents.typeKey, RESIGNATION_TEMPLATE_KEY), eq(documents.phase, 'issued'), ne(documents.status, 'voided'), isNull(documents.sentAt)))
    .all()
    .map((d) => d.id);
  for (const id of linked) {
    const voided = voidDocumentInternal(tx, deps, ctx, { id, reason: RESIGNATION_REVOKED });
    if (!voided.ok) throw new MembersAborted(voided);
  }
  return linked;
}

/** Grund am stornierten Dokument (steht in der Akte, nicht im Protokoll). Deutsch wie der Brief. */
const RESIGNATION_REVOKED = 'Austritt zurückgenommen';

export const membershipDeleteSchema = z.object({ membershipId: id });

/**
 * Löschen (nur ein Mensch): nach Ablauf der Frist, oder sofort ein offener Antrag, der irrtümlich angelegt wurde
 * (Handoff D1). Die Rolle am Kontakt bleibt als beendete Zeile — Kontakte regeln ihre Rollen selbst.
 */
export async function deleteMembership(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, membershipDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRow(deps.db, parsed.value.membershipId);
  if (!row) return notFound('membership', parsed.value.membershipId);
  const today = todayIn(deps);
  const openFees = openFeeCountInternal(deps.db, row.id);
  if (openFees > 0) return membersConflict('membershipHasOpenFees', { count: openFees });
  const retainUntil = retainUntilOf(deps.db, row);
  const openApplication = membershipStatus(row, today) === 'applied';
  if (!openApplication && (retainUntil === null || retainUntil >= today)) return membersConflict('membershipNotDue', { retainUntil: retainUntil ?? 'none' });
  // Handoff 3: Gelöscht werden kann nur ein Antrag ohne Beitrag.
  if (openApplication && deps.db.select({ id: memberFeeCharges.id }).from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, row.id)).get()) return membersConflict('membershipHasFees');
  return deps.db.transaction((tx: DbOrTx) => {
    deleteMembershipInternal(tx, deps, ctx, row);
    return ok({ id: row.id });
  });
}
